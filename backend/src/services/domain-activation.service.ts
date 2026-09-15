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
import { buildRequiredDnsRecords } from './dns-records.service';
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

const TRIAL_DAYS = 30;

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
        found = results.some((r) => normalizeRecordValue(r.exchange) === normalizeRecordValue(record.value));
      } else if (record.type === 'TXT') {
        const results = await resolveTxt(fqdn);
        found = results.some((chunks) => normalizeRecordValue(chunks.join('')) === normalizeRecordValue(record.value));
      }
    } catch {
      found = false;
    }
    details.push({ type: record.type, name: record.name, found });
  }

  return { verified: details.every((d) => d.found), details };
}

async function loadCredentialOrThrow(
  domainId: string
): Promise<{ provider: DnsProviderName; credential: ProviderCredential; docId: string }> {
  const cred = await DomainDnsCredentialModel.findOne({ domainId }).select('+credentialEncrypted');
  if (!cred) {
    throw new DomainActivationError(
      'No DNS provider credential is connected for this domain yet. Ask the Tenant Admin to connect one first.',
      'DNS_PROVIDER_CREDENTIAL_MISSING',
      409
    );
  }
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

  if (domain.isPrimary) {
    const tenant = await TenantModel.findById(domain.tenantId);
    if (tenant && !tenant.trialStartedAt) {
      tenant.trialStartedAt = new Date();
      tenant.trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      await tenant.save();
      await logAudit({
        actorRole: 'SYSTEM',
        action: 'TENANT_TRIAL_STARTED',
        resource: 'TENANT',
        resourceId: tenant._id.toString(),
        tenantId: tenant._id.toString(),
        metadata: { trialStartedAt: tenant.trialStartedAt, trialEndsAt: tenant.trialEndsAt },
      });
    }
  }

  // Per requirements: DNS provider authorization is not retained once activation succeeds.
  await DomainDnsCredentialModel.deleteOne({ domainId: domain._id });
}

/**
 * The "Activate Domain" action (Super Admin). Provisions/enables the domain
 * in Stalwart, fetches its real DKIM keys, builds+persists the required DNS
 * record set, checks the connected DNS provider for conflicts, creates the missing records, and
 * makes an immediate verification attempt. If not yet verifiable, the domain
 * is left in 'activating' for the background sweep to keep polling.
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

  const { provider, credential } = await loadCredentialOrThrow(domain._id.toString());

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

  // 2. Fetch real DKIM keys and build the canonical record set.
  const dkimKeys = await stalwartClient.getActiveDkimKeys(stalwartDomainId);
  const records = buildRequiredDnsRecords(domain.domainName, dkimKeys);
  domain.dnsRecords = records;
  const rsaKey = dkimKeys.find((k) => k.algorithm === 'Dkim1RsaSha256') || dkimKeys[0];
  domain.dkimSelector = rsaKey?.selector || null;
  domain.dkimPublicKey = rsaKey?.publicKey || null;
  await domain.save();

  // 3. Conflict-check against the provider's existing zone before creating anything.
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

  // 4. Create the (non-conflicting, missing) records.
  if (toCreate.length > 0) {
    await createProviderDnsRecords(provider, credential, domain.domainName, toCreate.map(toGenericRecord));
  }

  // 5. Immediate verification attempt; leaves 'activating' for the sweep if not yet visible.
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

  const { provider, credential } = await loadCredentialOrThrow(domain._id.toString());
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
