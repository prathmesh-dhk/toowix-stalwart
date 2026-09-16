import { goDaddyClient } from '../godaddy/client';
import { hostingerClient } from '../hostinger/client';
import { cloudflareClient } from '../cloudflare/client';
import { DnsProviderName } from '../db/models/DomainDnsCredential';

/**
 * Thin dispatch-by-provider layer so domain-activation.service.ts doesn't
 * need to know each provider's native call shape (GoDaddy: key+secret pair;
 * Hostinger/Cloudflare: single bearer token). Each provider's own client
 * (backend/src/godaddy/, backend/src/hostinger/, backend/src/cloudflare/)
 * keeps its real, native method signatures — this module just picks the
 * right one and adapts the credential shape, so adding a new provider means
 * adding one branch here plus its own client module, not touching the
 * orchestrator.
 */

export type ProviderCredential = { apiKey: string; apiSecret: string } | { token: string };

export interface GenericDnsRecord {
  type: string;
  name: string;
  data: string;
  ttl?: number;
  priority?: number | null;
  // SRV-specific
  weight?: number | null;
  port?: number | null;
  // CAA-specific
  flags?: number | null;
  tag?: string | null;
}

export function isKnownProvider(value: string): value is DnsProviderName {
  return value === 'godaddy' || value === 'hostinger' || value === 'cloudflare';
}

export async function verifyProviderCredential(
  provider: DnsProviderName,
  credential: ProviderCredential,
  domain: string
): Promise<{ domain: string }> {
  if (provider === 'godaddy' && 'apiKey' in credential) {
    return goDaddyClient.verifyCredential(credential.apiKey, credential.apiSecret, domain);
  }
  if (provider === 'hostinger' && 'token' in credential) {
    return hostingerClient.verifyCredential(credential.token, domain);
  }
  if (provider === 'cloudflare' && 'token' in credential) {
    return cloudflareClient.verifyCredential(credential.token, domain);
  }
  throw new Error(`Unsupported DNS provider or credential shape: ${provider}`);
}

export async function listProviderDnsRecords(
  provider: DnsProviderName,
  credential: ProviderCredential,
  domain: string,
  type: string,
  name: string
): Promise<GenericDnsRecord[]> {
  if (provider === 'godaddy' && 'apiKey' in credential) {
    return goDaddyClient.listDnsRecords(credential.apiKey, credential.apiSecret, domain, type, name);
  }
  if (provider === 'hostinger' && 'token' in credential) {
    return hostingerClient.listDnsRecords(credential.token, domain, type, name);
  }
  if (provider === 'cloudflare' && 'token' in credential) {
    return cloudflareClient.listDnsRecords(credential.token, domain, type, name);
  }
  throw new Error(`Unsupported DNS provider or credential shape: ${provider}`);
}

export async function createProviderDnsRecords(
  provider: DnsProviderName,
  credential: ProviderCredential,
  domain: string,
  records: GenericDnsRecord[]
): Promise<void> {
  if (provider === 'godaddy' && 'apiKey' in credential) {
    await goDaddyClient.createDnsRecords(
      credential.apiKey,
      credential.apiSecret,
      domain,
      records.map((r) => ({
        type: r.type as any,
        name: r.name,
        data: r.data,
        ttl: r.ttl,
        ...(r.priority != null ? { priority: r.priority } : {}),
        ...(r.weight != null ? { weight: r.weight } : {}),
        ...(r.port != null ? { port: r.port } : {}),
        ...(r.flags != null ? { flags: r.flags } : {}),
        ...(r.tag ? { tag: r.tag } : {}),
      }))
    );
    return;
  }
  if (provider === 'hostinger' && 'token' in credential) {
    await hostingerClient.createDnsRecords(credential.token, domain, records);
    return;
  }
  if (provider === 'cloudflare' && 'token' in credential) {
    await cloudflareClient.createDnsRecords(credential.token, domain, records);
    return;
  }
  throw new Error(`Unsupported DNS provider or credential shape: ${provider}`);
}

/**
 * Synchronizes one (type, name) group to the caller's desired final record
 * set — used to resolve a conflict by overwriting rather than stopping.
 * The caller is responsible for including any foreign records it wants
 * preserved (e.g. an unrelated google-site-verification TXT living at the
 * same "@" name as our SPF record) in `records`; anything already present
 * that ISN'T in that list is removed.
 */
export async function replaceProviderDnsRecordGroup(
  provider: DnsProviderName,
  credential: ProviderCredential,
  domain: string,
  type: string,
  name: string,
  records: Array<{ data: string; ttl?: number; priority?: number | null; weight?: number | null; port?: number | null; flags?: number | null; tag?: string | null }>
): Promise<void> {
  if (provider === 'godaddy' && 'apiKey' in credential) {
    await goDaddyClient.replaceDnsRecordGroup(credential.apiKey, credential.apiSecret, domain, type, name, records);
    return;
  }
  if (provider === 'hostinger' && 'token' in credential) {
    await hostingerClient.replaceDnsRecordGroup(credential.token, domain, type, name, records);
    return;
  }
  if (provider === 'cloudflare' && 'token' in credential) {
    await cloudflareClient.replaceDnsRecordGroup(credential.token, domain, type, name, records);
    return;
  }
  throw new Error(`Unsupported DNS provider or credential shape: ${provider}`);
}
