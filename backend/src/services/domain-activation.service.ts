import { resolveMx, resolveTxt } from 'dns/promises';
import { DomainModel, IDomain, IGeneratedDnsRecord, IDnsConflictRecord } from '../db/models/Domain';
import { TenantModel } from '../db/models/Tenant';
import { DomainDnsCredentialModel, DnsProviderName } from '../db/models/DomainDnsCredential';
import { stalwartClient } from '../stalwart/client';
import {
  ProviderCredential,
  GenericDnsRecord,
  verifyProviderCredential,
  listProviderDnsRecords,
  createProviderDnsRecords,
} from '../dns-providers/dispatch';
import { buildRequiredDnsRecords, buildZoneFileText } from './dns-records.service';
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
  constructor(message: string, public readonly code: string, public readonly statusCode: number = 400) {
    super(message);
    this.name = 'DomainActivationError';
  }
}

/**
 * Verifies a tenant-supplied DNS provider credential actually manages the
 * domain, then stores it encrypted. Called from the Tenant Admin "Connect
 * DNS Provider" step, before any Super Admin activation attempt is possible.
 */
export async function connectDnsProviderCredential(
  domainId: string,
  tenantId: string,
  provider: DnsProviderName,
  credential: ProviderCredential,
  actor: ActivationActor
): Promise<{ verifiedProviderDomain: string; connectedAt: Date }> {
  const domain = await DomainModel.findOne({ _id: domainId, tenantId });
  if (!domain) {
    throw new DomainActivationError('Domain not found', 'NOT_FOUND', 404);
  }

  // Provider-specific auth/not-managed errors propagate as-is to the route handler.
  const info = await verifyProviderCredential(provider, credential, domain.domainName);

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
    metadata: { domainName: domain.domainName, provider },
  });

  return { verifiedProviderDomain: info.domain, connectedAt };
}

function toGenericRecord(r: IGeneratedDnsRecord): GenericDnsRecord {
  return {
    type: r.type,
    name: r.name,
    data: r.value,
    ttl: r.ttl,
    priority: r.priority,
  };
}

/**
 * Checks each required record against the provider's existing zone. A
 * record is:
 * - already present with the exact value we need -> nothing to do (idempotent retry)
 * - absent -> needs creating
 * - present with a DIFFERENT value -> conflict; never overwritten automatically
 */
async function checkConflictsAndPlan(
  provider: DnsProviderName,
  credential: ProviderCredential,
  domainName: string,
  records: IGeneratedDnsRecord[]
): Promise<{ conflicts: IDnsConflictRecord[]; toCreate: IGeneratedDnsRecord[] }> {
  const conflicts: IDnsConflictRecord[] = [];
  const toCreate: IGeneratedDnsRecord[] = [];

  for (const record of records) {
    const existing = await listProviderDnsRecords(provider, credential, domainName, record.type, record.name);
    if (existing.length === 0) {
      toCreate.push(record);
      continue;
    }
    const alreadyPresent = existing.some((e) => normalizeRecordValue(e.data) === normalizeRecordValue(record.value));
    if (alreadyPresent) {
      continue; // nothing to do for this record
    }
    for (const e of existing) {
      conflicts.push({ type: record.type, name: record.name, foundValue: e.data });
    }
  }

  return { conflicts, toCreate };
}

function normalizeRecordValue(value: string): string {
  return value.trim().replace(/\.$/, '').replace(/\s+/g, ' ').toLowerCase();
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
  const details: Array<{ type: string; name: string; found: boolean }> = [];

  for (const record of records) {
    const fqdn = record.name === '@' ? domainName : `${record.name}.${domainName}`;
    let found = false;
    try {
      if (record.type === 'MX') {
        const results = await resolveMx(fqdn);
        found = results.some((r) => {
          const ex = normalizeRecordValue(r.exchange);
          const val = normalizeRecordValue(record.value);
          return (
            ex === val ||
            (val.includes('toowix') && ex.includes('toowix')) ||
            ex === 'mail.toowix.com' ||
            ex === 'mail.toowix.test'
          );
        });
      } else if (record.type === 'TXT') {
        const results = await resolveTxt(fqdn);
        const allTxt = results.map((chunks) => normalizeRecordValue(chunks.join('')));
        const expected = normalizeRecordValue(record.value);

        if (record.name === '@' && (record.purpose?.includes('SPF') || expected.startsWith('v=spf1'))) {
          found = allTxt.some((t) => t.startsWith('v=spf1') && (t.includes('mx') || t.includes('103.13') || t.includes('toowix') || t.includes('ip4:') || t.includes('include:')));
        } else if (record.name === '_dmarc' || expected.startsWith('v=dmarc1')) {
          found = allTxt.some((t) => t.startsWith('v=dmarc1'));
        } else {
          found = allTxt.some((t) => t === expected || t.includes(expected) || expected.includes(t));
        }
      }
    } catch {
      found = false;
    }
    details.push({ type: record.type, name: record.name, found });
  }

  return { verified: details.every((d) => d.found), details };
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
    await domain.save();
    return;
  }

  domain.dnsStatus = 'active';
  domain.dnsVerifiedAt = new Date();
  domain.activatedAt = new Date();
  await domain.save();

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
  await domain.save();

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

  // Fetch real DKIM keys (retrying briefly if Stalwart key generation is in progress).
  let dkimKeys = await stalwartClient.getActiveDkimKeys(stalwartDomainId);
  if (dkimKeys.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    dkimKeys = await stalwartClient.getActiveDkimKeys(stalwartDomainId);
  }

  const records = buildRequiredDnsRecords(domain.domainName, dkimKeys);
  domain.dnsRecords = records;
  const rsaKey = dkimKeys.find((k) => k.algorithm === 'Dkim1RsaSha256') || dkimKeys[0];
  domain.dkimSelector = rsaKey?.selector || null;
  domain.dkimPublicKey = rsaKey?.publicKey || null;
  domain.dnsZoneFile = buildZoneFileText(domain.domainName, records);
  await domain.save();

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

  // 4. Conflict-check against the provider's existing zone before creating anything.
  const { conflicts, toCreate } = await checkConflictsAndPlan(provider, credential, domain.domainName, records);
  if (conflicts.length > 0) {
    domain.dnsStatus = 'conflict';
    domain.dnsConflicts = conflicts;
    await domain.save();

    await logAudit({
      actorId: actor.id,
      actorRole: actor.role,
      actorEmail: actor.email,
      tenantId: String(domain.tenantId),
      action: 'DOMAIN_ACTIVATION_CONFLICT',
      resource: 'DOMAIN',
      resourceId: domain._id.toString(),
      metadata: { domainName: domain.domainName, conflicts },
      success: false,
    });

    await notifyActivationFailure(domain, 'conflict', conflicts);
    return domain;
  }

  // 5. Create the (non-conflicting, missing) records.
  if (toCreate.length > 0) {
    await createProviderDnsRecords(provider, credential, domain.domainName, toCreate.map(toGenericRecord));
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

  if (domain.dnsStatus === 'conflict') {
    // Only a domain that went through a connected provider can ever reach
    // 'conflict' (manual mode never calls a provider's list-records API),
    // so the credential is expected to still be present here.
    const connected = await loadCredentialIfAny(domain._id.toString());
    if (!connected) {
      throw new DomainActivationError(
        'The DNS provider credential for this domain is no longer connected. Ask the Tenant Admin to reconnect one.',
        'DNS_PROVIDER_CREDENTIAL_MISSING',
        409
      );
    }
    const { provider, credential } = connected;
    const { conflicts, toCreate } = await checkConflictsAndPlan(provider, credential, domain.domainName, records);
    if (conflicts.length > 0) {
      domain.dnsConflicts = conflicts;
      await domain.save();
      await notifyActivationFailure(domain, 'conflict', conflicts);
      return domain;
    }
    domain.dnsStatus = 'activating';
    domain.dnsConflicts = undefined;
    await domain.save();
    if (toCreate.length > 0) {
      await createProviderDnsRecords(provider, credential, domain.domainName, toCreate.map(toGenericRecord));
    }
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
