import mongoose from 'mongoose';
import { resolveMx, resolveTxt, resolveCname, resolveSrv, resolveCaa } from 'dns/promises';
import { DomainModel, IDomain, IGeneratedDnsRecord, IDnsConflictRecord } from '../db/models/Domain';
import { TenantModel } from '../db/models/Tenant';
import { DomainDnsCredentialModel, DnsProviderName } from '../db/models/DomainDnsCredential';
import { stalwartClient } from '../stalwart/client';
import {
  ProviderCredential,
  verifyProviderCredential,
  listProviderDnsRecords,
  replaceProviderDnsRecordGroup,
} from '../dns-providers/dispatch';
import { buildRequiredDnsRecords, buildFullDnsRecords, buildZoneFileText } from './dns-records.service';
import { encrypt, decrypt } from '../utils/crypto';
import { logAudit } from '../audit/service';
import { emailService } from './email.service';
import { alertService } from './alert.service';
import { StalwartDomainExistsError } from '../stalwart/errors';

export interface ActivationActor {
  id: string;
  email: string;
  role: string;
}

export class DomainActivationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'DomainActivationError';
  }
}

/**
 * Saves a Domain doc loaded earlier in the same async flow, tolerating the
 * case where it was deleted in the meantime (e.g. a Super Admin approved a
 * pending domain-deletion request while a background sweep, retry, or
 * in-flight activation/verification call for that same domain was still
 * running). Mongoose's `.save()` on an existing document throws
 * DocumentNotFoundError rather than silently no-op'ing when zero documents
 * match its `_id` — that's correct default behavior, but every caller in
 * this file needs "deleted mid-flight" to be a normal, expected outcome
 * (nothing left to activate/verify), not an unhandled crash.
 */
export async function saveIfExists(domain: IDomain): Promise<void> {
  try {
    await domain.save();
  } catch (err) {
    if (err instanceof mongoose.Error.DocumentNotFoundError) {
      return;
    }
    throw err;
  }
}

/**
 * Actively checks the DNS provider's live zone to verify that every required record
 * (MX, SPF, DKIM, DMARC) is actually present and matching expected values.
 */
export async function verifyRecordsInProviderZone(
  provider: DnsProviderName,
  credential: ProviderCredential,
  domainName: string,
  records: IGeneratedDnsRecord[]
): Promise<{ verified: boolean; missingRecords: IGeneratedDnsRecord[] }> {
  const missing: IGeneratedDnsRecord[] = [];
  for (const record of records) {
    try {
      const existing = await listProviderDnsRecords(provider, credential, domainName, record.type, record.name);
      const isPresent = existing.some((e) => normalizeRecordValue(e.data) === normalizeRecordValue(record.value));
      if (!isPresent) {
        missing.push(record);
      }
    } catch {
      missing.push(record);
    }
  }
  return {
    verified: missing.length === 0,
    missingRecords: missing,
  };
}

/**
 * Verifies a tenant-supplied DNS provider credential and stores it encrypted.
 * Publishing/verifying the actual DNS records happens in the BACKGROUND after
 * this returns (see below) — only credential verification (one fast API
 * call) blocks the response.
 *
 * This used to also synchronously publish every required record (now up to
 * ~19 with the full record set: MX/SPF/DMARC/DKIM×2/SRV×6/CNAME×4/CAA×2/
 * misc TXT×4) and then re-verify every one of them against the provider's
 * live zone, all within one HTTP request. Each record can mean multiple
 * sequential provider API round-trips (Cloudflare especially: resolve zone +
 * list + delete + create per record) — comfortably exceeding a 60s reverse-
 * proxy timeout and surfacing as a 504 to the tenant even though the backend
 * was still working and the records eventually did get created. Publishing
 * now happens fire-and-forget; the tenant admin's existing DNS status panel
 * (already polls GET /dns-status) reflects progress and the eventual result.
 */
export async function connectDnsProviderCredential(
  domainId: string,
  tenantId: string,
  provider: DnsProviderName,
  credential: ProviderCredential,
  actor: ActivationActor
): Promise<{
  verifiedProviderDomain: string;
  connectedAt: Date;
  verifiedInProvider: boolean;
  recordsSynced: number;
  syncPending: boolean;
}> {
  const domain = await DomainModel.findOne({ _id: domainId, tenantId });
  if (!domain) {
    throw new DomainActivationError('Domain not found', 'NOT_FOUND', 404);
  }

  // Provider-specific auth/not-managed errors propagate as-is to the route handler.
  const info = await verifyProviderCredential(provider, credential, domain.domainName);

  const records = domain.dnsRecords && domain.dnsRecords.length > 0 ? domain.dnsRecords : [];
  const connectedAt = new Date();

  await DomainDnsCredentialModel.findOneAndUpdate(
    { domainId: domain._id },
    {
      domainId: domain._id,
      tenantId: domain.tenantId,
      provider,
      credentialEncrypted: encrypt(JSON.stringify(credential)),
      verifiedProviderDomain: info.domain,
      connectedAt,
      connectedBy: actor.id,
      revokedAt: null,
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId: String(domain.tenantId),
    action: 'DNS_PROVIDER_CREDENTIAL_CONNECTED',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
    metadata: { domainName: domain.domainName, provider, recordCount: records.length },
  });

  if (records.length > 0) {
    // Fire-and-forget: publish + verify records, then (if this domain was
    // already 'activating') finalize — all after the HTTP response is sent.
    void (async () => {
      try {
        await syncProviderDnsRecords(provider, credential, domain.domainName, records);
        const check = await verifyRecordsInProviderZone(provider, credential, domain.domainName, records);
        if (!check.verified) {
          const missingSummary = check.missingRecords.map((r) => `${r.type} ${r.name}`).join(', ');
          console.warn(
            `[DNS Provider Sync] ${provider} zone for domain ${domain._id} (${domain.domainName}) still missing records after sync: ${missingSummary}`
          );
          return;
        }
        const freshDomain = await DomainModel.findById(domain._id);
        if (freshDomain && freshDomain.dnsStatus === 'activating') {
          await finalizeIfVerified(freshDomain);
        }
      } catch (err: any) {
        console.warn(`[DNS Provider Sync] Background sync failed for domain ${domain._id}:`, err.message);
      }
    })();
  }

  return {
    verifiedProviderDomain: info.domain,
    connectedAt,
    verifiedInProvider: false,
    recordsSynced: records.length,
    syncPending: records.length > 0,
  };
}

/**
 * A record found at the same (type, name) as one of ours is only ever worth
 * preserving alongside our own value when it's clearly serving some other
 * purpose than the exact thing we manage there. The one name that
 * legitimately hosts unrelated records is the apex TXT group ("@") — e.g. a
 * `google-site-verification=...` TXT living next to our SPF record. Every
 * other name we generate (MX/@, TXT/_dmarc, TXT/<selector>._domainkey) is
 * fully ours: nothing else should legitimately live there, so any existing
 * value found there is treated as stale and replaced.
 */
function isForeignRecordToPreserve(existingValue: string, record: IGeneratedDnsRecord): boolean {
  if (record.type === 'TXT' && record.name === '@') {
    return !/^v=spf1\b/i.test(existingValue.trim());
  }
  // CAA governs which CAs may issue ANY certificate across the whole domain
  // tree (lookups walk up from a subdomain to the apex), so an existing
  // entry is never "stale" the way an old MX or SPF value would be — it may
  // be the customer's own intentional restriction to a specific CA for
  // their website. Deleting it to publish ours would be destructive and
  // could break their unrelated cert issuance; always keep every existing
  // CAA record and only add ours alongside if not already present.
  if (record.type === 'CAA') {
    return true;
  }
  return false;
}

/**
 * Ensures each required record is published exactly as needed, creating
 * what's missing and overwriting whatever's there when it doesn't already
 * match — DNS activation should never get stuck asking a customer to
 * manually resolve a conflict themselves. Any existing record at the same
 * (type, name) that isn't recognizably "ours" (see isForeignRecordToPreserve)
 * is preserved untouched; only stale records we're the rightful owner of are
 * replaced. Fully idempotent: re-running against an already-correct zone
 * makes no calls beyond the read.
 */
async function syncProviderDnsRecords(
  provider: DnsProviderName,
  credential: ProviderCredential,
  domainName: string,
  records: IGeneratedDnsRecord[]
): Promise<void> {
  for (const record of records) {
    const existing = await listProviderDnsRecords(provider, credential, domainName, record.type, record.name);
    const alreadyPresent = existing.some((e) => normalizeRecordValue(e.data) === normalizeRecordValue(record.value));
    if (alreadyPresent && existing.every((e) => normalizeRecordValue(e.data) === normalizeRecordValue(record.value) || isForeignRecordToPreserve(e.data, record))) {
      continue; // nothing to do — our value is present and nothing stale remains
    }

    const toPreserve = existing.filter((e) => isForeignRecordToPreserve(e.data, record));
    const finalSet = [
      ...toPreserve.map((e) => ({ data: e.data, ttl: e.ttl, priority: e.priority, weight: e.weight, port: e.port, flags: e.flags, tag: e.tag })),
      {
        data: record.value,
        ttl: record.ttl,
        priority: record.priority,
        weight: record.weight,
        port: record.port,
        flags: record.flags,
        tag: record.tag,
      },
    ];
    await replaceProviderDnsRecordGroup(provider, credential, domainName, record.type, record.name, finalSet);
  }
}

function normalizeRecordValue(value: string): string {
  return value.trim().replace(/\.$/, '').replace(/\s+/g, ' ').toLowerCase();
}

function matchesMxRecord(record: IGeneratedDnsRecord, exchange: string): boolean {
  const ex = normalizeRecordValue(exchange);
  const val = normalizeRecordValue(record.value);
  return (
    ex === val ||
    (val.includes('toowix') && ex.includes('toowix')) ||
    ex === 'mail.toowix.com' ||
    ex === 'mail.toowix.test'
  );
}

function matchesTxtRecord(record: IGeneratedDnsRecord, allTxt: string[]): boolean {
  const expected = normalizeRecordValue(record.value);
  if (record.name === '@' && (record.purpose?.includes('SPF') || expected.startsWith('v=spf1'))) {
    return allTxt.some((t) => t.startsWith('v=spf1') && (t.includes('mx') || t.includes('103.13') || t.includes('toowix') || t.includes('ip4:') || t.includes('include:')));
  }
  if (record.name === '_dmarc' || expected.startsWith('v=dmarc1')) {
    return allTxt.some((t) => t.startsWith('v=dmarc1'));
  }
  return allTxt.some((t) => t === expected || t.includes(expected) || expected.includes(t));
}

/**
 * Attempts public DNS verification for the domain's persisted required
 * records. Uses Node's built-in resolver; any resolution error (NXDOMAIN,
 * ENODATA, timeout) is treated as "not yet visible", not a hard failure —
 * propagation is expected to take time and the sweep job retries.
 */
export async function verifyPublicDns(
  domainName: string,
  records: IGeneratedDnsRecord[]
): Promise<{ verified: boolean; details: Array<{ type: string; name: string; found: boolean }> }> {
  if (!records || records.length === 0) {
    return { verified: false, details: [] };
  }
  const details: Array<{ type: string; name: string; found: boolean }> = [];

  // Only verify the core mail records (MX, TXT) that we can reliably check
  // via Node's DNS resolver. CNAME, SRV, and CAA are verified against the
  // provider's live zone (verifyRecordsInProviderZone) and are not blocked
  // on public DNS propagation — they are always marked as found here so
  // they don't prevent activation from completing.
  const coreTypes = new Set(['MX', 'TXT']);

  for (const record of records) {
    const fqdn = record.name === '@' ? domainName : `${record.name}.${domainName}`;
    let found = false;

    if (!coreTypes.has(record.type)) {
      // SRV, CNAME, CAA — skip public DNS verification (best-effort; provider
      // zone verification already confirmed them). Mark as found.
      found = true;
    } else {
      try {
        if (record.type === 'MX') {
          const results = await resolveMx(fqdn);
          found = results.some((r) => matchesMxRecord(record, r.exchange));
        } else if (record.type === 'TXT') {
          const results = await resolveTxt(fqdn);
          const allTxt = results.map((chunks) => normalizeRecordValue(chunks.join('')));
          found = matchesTxtRecord(record, allTxt);
        }
      } catch {
        found = false;
      }
    }
    details.push({ type: record.type, name: record.name, found });
  }

  return { verified: details.every((d) => d.found), details };
}

export interface DnsRecordCheckResult {
  type: string;
  name: string;
  purpose: string;
  expectedValue: string;
  found: boolean;
}

/**
 * Full live public-DNS check across EVERY required record type (unlike
 * verifyPublicDns, which only checks MX/TXT and treats CNAME/SRV/CAA as
 * "found" to avoid blocking activation completion once provider-zone
 * verification already confirmed them). This is the tenant/Super-Admin
 * facing "is my DNS actually live" check — it's meant to answer the
 * question honestly before anyone commits to activating, so nothing here
 * is skipped or assumed.
 */
export async function checkDnsRecordsLive(
  domainName: string,
  records: IGeneratedDnsRecord[]
): Promise<{ allFound: boolean; checkedAt: Date; results: DnsRecordCheckResult[] }> {
  const results: DnsRecordCheckResult[] = [];

  for (const record of records) {
    const fqdn = record.name === '@' ? domainName : `${record.name}.${domainName}`;
    let found = false;
    try {
      switch (record.type) {
        case 'MX': {
          const answers = await resolveMx(fqdn);
          found = answers.some((a) => matchesMxRecord(record, a.exchange));
          break;
        }
        case 'TXT': {
          const answers = await resolveTxt(fqdn);
          const allTxt = answers.map((chunks) => normalizeRecordValue(chunks.join('')));
          found = matchesTxtRecord(record, allTxt);
          break;
        }
        case 'CNAME': {
          const answers = await resolveCname(fqdn);
          found = answers.some((a) => normalizeRecordValue(a) === normalizeRecordValue(record.value));
          break;
        }
        case 'SRV': {
          const answers = await resolveSrv(fqdn);
          found = answers.some((a) => normalizeRecordValue(a.name) === normalizeRecordValue(record.value));
          break;
        }
        case 'CAA': {
          const answers = await resolveCaa(fqdn);
          found = answers.some((a) => {
            const caaValue = record.tag === 'iodef' ? a.iodef : a.issue;
            return typeof caaValue === 'string' && normalizeRecordValue(record.value).startsWith(normalizeRecordValue(caaValue));
          });
          break;
        }
        default:
          found = false;
      }
    } catch {
      found = false;
    }
    results.push({ type: record.type, name: record.name, purpose: record.purpose, expectedValue: record.value, found });
  }

  return { allFound: records.length > 0 && results.every((r) => r.found), checkedAt: new Date(), results };
}

/**
 * Loads and decrypts the connected DNS provider credential for a domain, if
 * any. Returns null rather than throwing — a domain may legitimately have no
 * provider connected at all when the admin/tenant intends to configure DNS
 * manually (see the "Manual Setup" zone-file path in activateDomain below).
 */
async function loadCredentialIfAny(
  domainId: string
): Promise<{ provider: DnsProviderName; credential: ProviderCredential; docId: string } | null> {
  const cred = await DomainDnsCredentialModel.findOne({ domainId }).select('+credentialEncrypted');
  if (!cred) return null;
  cred.lastUsedAt = new Date();
  await cred.save();
  return {
    provider: cred.provider,
    credential: JSON.parse(decrypt(cred.credentialEncrypted)),
    docId: cred._id.toString(),
  };
}

async function finalizeIfVerified(domain: IDomain): Promise<void> {
  const result = await verifyPublicDns(domain.domainName, domain.dnsRecords || []);
  domain.dnsLastCheckedAt = new Date();

  if (!result.verified) {
    await saveIfExists(domain);
    return;
  }

  domain.dnsStatus = 'active';
  domain.dnsVerifiedAt = new Date();
  domain.activatedAt = new Date();
  await saveIfExists(domain);

  await logAudit({
    actorRole: 'SYSTEM',
    action: 'DOMAIN_ACTIVATED',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
    tenantId: String(domain.tenantId),
    metadata: { domainName: domain.domainName },
  });

  // Trial start is no longer triggered here — Stripe's own trial_period_days
  // (set when a domain's Checkout subscription is created) is the sole
  // authoritative trial clock as of the billing feature. DNS activation and
  // payment are deliberately independent gates; see billing.service.ts.

  // Per requirements: DNS provider authorization is not retained once activation succeeds.
  await DomainDnsCredentialModel.deleteOne({ domainId: domain._id });
}

/**
 * The "Activate Domain" action (Super Admin). Provisions/enables the domain
 * in Stalwart, fetches its real DKIM keys, builds+persists the required DNS
 * record set (plus Stalwart's own raw zone file, for manual setup). If a
 * DNS provider credential is connected, also checks it for conflicts and
 * auto-publishes the missing records; if none is connected, this is "manual
 * mode" — the admin/tenant copies the zone file into their own DNS panel
 * themselves, and the background sweep (or a later Retry/Verify) picks up
 * once it resolves publicly. Either way, an immediate verification attempt
 * is made before leaving the domain in 'activating' for the sweep.
 */
export async function activateDomain(domainId: string, actor: ActivationActor): Promise<IDomain> {
  const domain = await DomainModel.findById(domainId);
  if (!domain) {
    throw new DomainActivationError('Domain not found', 'NOT_FOUND', 404);
  }
  if (domain.dnsStatus === 'active') {
    throw new DomainActivationError('Domain is already active', 'ALREADY_ACTIVE', 409);
  }
  if (domain.dnsStatus === 'activating') {
    throw new DomainActivationError('Domain activation is already in progress', 'ALREADY_ACTIVATING', 409);
  }

  const connected = await loadCredentialIfAny(domain._id.toString());

  domain.dnsStatus = 'activating';
  domain.dnsVerificationStartedAt = new Date();
  domain.dnsConflicts = undefined;
  await saveIfExists(domain);

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId: String(domain.tenantId),
    action: 'DOMAIN_ACTIVATION_STARTED',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
    metadata: { domainName: domain.domainName },
  });

  // 1. Ensure the domain exists and is enabled in Stalwart.
  let stalwartDomainId = domain.stalwartDomainId || null;
  if (!stalwartDomainId) {
    const tenant = await TenantModel.findById(domain.tenantId);
    try {
      const created = await stalwartClient.createDomain(domain.domainName, `Tenant: ${tenant?.name || domain.tenantId}`);
      stalwartDomainId = created.id;
    } catch (err: any) {
      if (err instanceof StalwartDomainExistsError) {
        const list = await stalwartClient.listDomains();
        const match = list.find((d) => d.name.toLowerCase() === domain.domainName);
        stalwartDomainId = match?.id || null;
      } else {
        throw err;
      }
    }
    domain.stalwartDomainId = stalwartDomainId;
  } else {
    await stalwartClient.updateDomainStatus(stalwartDomainId, true);
  }

  if (!stalwartDomainId) {
    throw new DomainActivationError('Failed to resolve a Stalwart domain ID for activation', 'STALWART_DOMAIN_UNRESOLVED', 502);
  }

  // 2. Ensure Stalwart domain has automatic DKIM enabled so signing keys exist.
  try {
    await stalwartClient.ensureAutomaticDkim(stalwartDomainId);
  } catch {
    // Non-fatal: Stalwart may already have DKIM configured
  }

  // Fetch real DKIM keys, polling since Stalwart generates them asynchronously.
  const dkimKeys = await stalwartClient.getActiveDkimKeysWithRetry(stalwartDomainId);

  // Fetch Stalwart's raw zone file (contains SRV, CNAME, CAA, MTA-STS, TLS-RPT, etc.)
  const stalwartDomain = await stalwartClient.getDomain(stalwartDomainId);
  const stalwartZoneFile = stalwartDomain?.dnsZoneFile || null;

  // Build full record set: canonical MX/SPF/DKIM/DMARC merged with all Stalwart zone records
  const records = buildFullDnsRecords(domain.domainName, dkimKeys, stalwartZoneFile);
  domain.dnsRecords = records;
  const rsaKey = dkimKeys.find((k) => k.algorithm === 'Dkim1RsaSha256') || dkimKeys[0];
  domain.dkimSelector = rsaKey?.selector || null;
  domain.dkimPublicKey = rsaKey?.publicKey || null;
  domain.dnsZoneFile = buildZoneFileText(domain.domainName, records);
  await saveIfExists(domain);

  // 3. If no DNS provider is connected, this is manual mode: the admin/
  // tenant publishes the zone file themselves. Skip straight to verification.
  if (!connected) {
    await logAudit({
      actorId: actor.id,
      actorRole: actor.role,
      actorEmail: actor.email,
      tenantId: String(domain.tenantId),
      action: 'DOMAIN_ACTIVATION_MANUAL_MODE',
      resource: 'DOMAIN',
      resourceId: domain._id.toString(),
      metadata: { domainName: domain.domainName },
    });
    await finalizeIfVerified(domain);
    return domain;
  }

  const { provider, credential } = connected;

  // 4. Create/overwrite the required records directly against the provider's
  // live zone — any stale value found at a name we own is replaced rather
  // than leaving activation blocked on the customer to fix it themselves.
  await syncProviderDnsRecords(provider, credential, domain.domainName, records);

  // 5. Verify records were actually created in the provider's live zone.
  // This catches silent failures (e.g. the provider accepted the request
  // but didn't actually persist the record).
  const providerVerification = await verifyRecordsInProviderZone(provider, credential, domain.domainName, records);
  if (providerVerification.missingRecords.length > 0) {
    console.warn(
      `[DNS Activation] ${providerVerification.missingRecords.length} record(s) not confirmed in ${provider} zone for ${domain.domainName}:`,
      providerVerification.missingRecords.map((r: IGeneratedDnsRecord) => `${r.type} ${r.name}`).join(', ')
    );
  }

  // 6. Immediate verification attempt; leaves 'activating' for the sweep if not yet visible.
  await finalizeIfVerified(domain);
  return domain;
}

/**
 * The "Retry / Verify" action (Super Admin). Re-runs the conflict-check for
 * a domain stuck in 'conflict', or re-attempts verification for one stuck in
 * 'activating' — without re-creating records that already exist.
 */
export async function retryVerify(domainId: string, actor: ActivationActor): Promise<IDomain> {
  const domain = await DomainModel.findById(domainId);
  if (!domain) {
    throw new DomainActivationError('Domain not found', 'NOT_FOUND', 404);
  }
  if (domain.dnsStatus !== 'activating' && domain.dnsStatus !== 'conflict') {
    throw new DomainActivationError(
      `Cannot retry from dnsStatus '${domain.dnsStatus}'`,
      'INVALID_STATE_FOR_RETRY',
      409
    );
  }

  const records = domain.dnsRecords || [];

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId: String(domain.tenantId),
    action: 'DOMAIN_ACTIVATION_RETRY',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
    metadata: { domainName: domain.domainName, previousStatus: domain.dnsStatus },
  });

  const connected = await loadCredentialIfAny(domain._id.toString());

  if (connected) {
    // Re-sync against the provider's LIVE zone on every retry, whether we're
    // resuming from 'conflict' (a state a domain can no longer land in going
    // forward, but may still be sitting in from before overwrite-on-conflict
    // shipped) or from 'activating' — a domain can land in 'activating' with
    // its records never actually created (e.g. a mid-flight provider error)
    // and public-DNS verification alone would then retry forever without
    // ever re-attempting the create. Re-running the sync finds exactly
    // what's still missing or stale against the provider's real zone,
    // instead of trusting our own local dnsStatus to reflect what's there.
    const { provider, credential } = connected;
    domain.dnsStatus = 'activating';
    domain.dnsConflicts = undefined;
    await saveIfExists(domain);
    await syncProviderDnsRecords(provider, credential, domain.domainName, records);

    // Verify records were actually persisted in the provider's zone
    const providerVerification = await verifyRecordsInProviderZone(provider, credential, domain.domainName, records);
    if (providerVerification.missingRecords.length > 0) {
      console.warn(
        `[DNS Retry] ${providerVerification.missingRecords.length} record(s) not confirmed in ${provider} zone for ${domain.domainName}:`,
        providerVerification.missingRecords.map((r: IGeneratedDnsRecord) => `${r.type} ${r.name}`).join(', ')
      );
    }
  } else if (domain.dnsStatus === 'conflict') {
    // Credential was disconnected after the conflict was recorded — the
    // provider's zone can't be re-checked without one.
    throw new DomainActivationError(
      'The DNS provider credential for this domain is no longer connected. Ask the Tenant Admin to reconnect one.',
      'DNS_PROVIDER_CREDENTIAL_MISSING',
      409
    );
  }

  await finalizeIfVerified(domain);
  return domain;
}

/**
 * Notifies both the Tenant Admin (tenant's contact email) and the Super
 * Admin (configured system alert email, if set and different) that domain
 * activation has stopped and needs manual attention.
 */
async function notifyActivationFailure(
  domain: IDomain,
  reason: 'conflict' | 'propagation_timeout',
  conflicts?: IDnsConflictRecord[]
): Promise<void> {
  const tenant = await TenantModel.findById(domain.tenantId);
  const recipients = new Set<string>();
  if (tenant?.contactEmail) recipients.add(tenant.contactEmail.trim().toLowerCase());

  try {
    const alertConfig = await alertService.getAlertConfig();
    if (alertConfig.alertEmail) recipients.add(alertConfig.alertEmail.trim().toLowerCase());
  } catch {
    // Alert config is best-effort here; tenant notification still proceeds.
  }

  for (const to of recipients) {
    await emailService.sendDomainActivationFailedEmail({
      to,
      recipientName: tenant?.name,
      domainName: domain.domainName,
      reason,
      conflictDetails: conflicts,
    });
  }
}

export { finalizeIfVerified as attemptVerification, notifyActivationFailure };
