import { TenantDnsCredentialModel } from '../db/models/TenantDnsCredential';
import { DomainModel } from '../db/models/Domain';
import { DnsProviderName } from '../db/models/DomainDnsCredential';
import { ProviderCredential, verifyProviderCredential } from '../dns-providers/dispatch';
import { encrypt, decrypt } from '../utils/crypto';
import { logAudit } from '../audit/service';

/** Deliberately not imported from domain-activation.service.ts — that file
 * imports FROM this one (saveAlreadyVerifiedTenantDnsCredential), so
 * importing its ActivationActor type back here would create a cycle. */
export interface DnsCredentialActor {
  id: string;
  email: string;
  role: string;
}

export interface TenantDnsCredentialSummary {
  provider: DnsProviderName;
  verified: boolean;
  verifiedProviderDomain: string | null;
  connectedAt: Date | null;
  lastUsedAt: Date | null;
}

/**
 * Saved credentials the tenant has ever revoked are kept as a row (cleared
 * of the secret, `revokedAt` set) purely so the fact one existed stays in
 * the audit trail — never surfaced back to the tenant as "saved".
 */
export async function listTenantDnsCredentials(tenantId: string): Promise<TenantDnsCredentialSummary[]> {
  const rows = await TenantDnsCredentialModel.find({ tenantId, revokedAt: null });
  return rows.map((r) => ({
    provider: r.provider,
    verified: r.verified,
    verifiedProviderDomain: r.verifiedProviderDomain || null,
    connectedAt: r.connectedAt || null,
    lastUsedAt: r.lastUsedAt || null,
  }));
}

/**
 * Saves (or replaces) the tenant's one credential for a provider. Verifies
 * against one of the tenant's existing domains when it has any — there's
 * nothing else to test a DNS provider credential against (verifyCredential
 * always checks a specific domain is manageable under the account). A
 * brand-new tenant with zero domains yet saves unverified; the credential
 * is re-verified for real the first time it's actually used against a real
 * domain (see useSavedTenantDnsCredential below and connectDnsProviderCredential's
 * saveForFuture path, which is already verified by the time it saves).
 */
export async function saveTenantDnsCredential(
  tenantId: string,
  provider: DnsProviderName,
  credential: ProviderCredential,
  actor: DnsCredentialActor
): Promise<TenantDnsCredentialSummary> {
  const anyDomain = await DomainModel.findOne({ tenantId }).sort({ createdAt: 1 });

  let verified = false;
  let verifiedProviderDomain: string | null = null;
  if (anyDomain) {
    const info = await verifyProviderCredential(provider, credential, anyDomain.domainName);
    verified = true;
    verifiedProviderDomain = info.domain;
  }

  await TenantDnsCredentialModel.findOneAndUpdate(
    { tenantId, provider },
    {
      tenantId,
      provider,
      credentialEncrypted: encrypt(JSON.stringify(credential)),
      verified,
      verifiedProviderDomain,
      connectedAt: new Date(),
      connectedBy: actor.id,
      revokedAt: null,
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId,
    action: 'TENANT_DNS_CREDENTIAL_SAVED',
    resource: 'TENANT_DNS_CREDENTIAL',
    resourceId: tenantId,
    metadata: { provider, verified },
  });

  return { provider, verified, verifiedProviderDomain, connectedAt: new Date(), lastUsedAt: null };
}

/**
 * Same upsert as saveTenantDnsCredential, but for a credential that was
 * JUST verified by the caller (connectDnsProviderCredential's "save for
 * future" path, already verified against the domain being set up) — avoids
 * a second, redundant verify call against the provider.
 */
export async function saveAlreadyVerifiedTenantDnsCredential(
  tenantId: string,
  provider: DnsProviderName,
  credential: ProviderCredential,
  verifiedProviderDomain: string,
  actor: DnsCredentialActor
): Promise<void> {
  await TenantDnsCredentialModel.findOneAndUpdate(
    { tenantId, provider },
    {
      tenantId,
      provider,
      credentialEncrypted: encrypt(JSON.stringify(credential)),
      verified: true,
      verifiedProviderDomain,
      connectedAt: new Date(),
      connectedBy: actor.id,
      revokedAt: null,
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId,
    action: 'TENANT_DNS_CREDENTIAL_SAVED',
    resource: 'TENANT_DNS_CREDENTIAL',
    resourceId: tenantId,
    metadata: { provider, verified: true, savedFromDomainSetup: true },
  });
}

export async function deleteTenantDnsCredential(
  tenantId: string,
  provider: DnsProviderName,
  actor: DnsCredentialActor
): Promise<boolean> {
  const result = await TenantDnsCredentialModel.findOneAndUpdate(
    { tenantId, provider, revokedAt: null },
    { credentialEncrypted: null, verified: false, revokedAt: new Date() }
  );
  if (!result) return false;

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId,
    action: 'TENANT_DNS_CREDENTIAL_REVOKED',
    resource: 'TENANT_DNS_CREDENTIAL',
    resourceId: tenantId,
    metadata: { provider },
  });
  return true;
}

/**
 * Loads and decrypts the tenant's saved credential for a provider, for the
 * "Use saved key" choice during domain setup / reconnect. Returns null if
 * none is saved (or it was revoked) — deliberately does NOT re-verify here;
 * the caller (connectDnsProviderCredential) already re-verifies against the
 * specific domain as its own first step, so this would just be a redundant
 * extra provider call.
 */
export async function getDecryptedTenantDnsCredential(
  tenantId: string,
  provider: DnsProviderName
): Promise<ProviderCredential | null> {
  const row = await TenantDnsCredentialModel.findOne({ tenantId, provider, revokedAt: null }).select(
    '+credentialEncrypted'
  );
  if (!row || !row.credentialEncrypted) return null;
  row.lastUsedAt = new Date();
  await row.save();
  return JSON.parse(decrypt(row.credentialEncrypted));
}
