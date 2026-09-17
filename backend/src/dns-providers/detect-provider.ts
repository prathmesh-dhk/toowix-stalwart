import { resolveNs } from 'dns/promises';
import { DnsProviderName } from '../db/models/DomainDnsCredential';

/**
 * Matches a domain's public nameservers against each supported provider's
 * known nameserver domain, so the setup wizard can pre-select the right
 * provider tab (or skip straight to manual setup) without the tenant having
 * to know who hosts their DNS. This only identifies WHO manages DNS — it
 * never implies we have any credential for that account; the tenant still
 * has to supply their own API key/token either way.
 */
const PROVIDER_NS_PATTERNS: Array<{ provider: DnsProviderName; pattern: RegExp }> = [
  { provider: 'cloudflare', pattern: /\.ns\.cloudflare\.com$/i },
  { provider: 'godaddy', pattern: /\.domaincontrol\.com$/i },
  { provider: 'hostinger', pattern: /(\.dns-parking\.com|\.hostinger\.com)$/i },
];

export interface DetectedDnsProvider {
  provider: DnsProviderName | null;
  nameservers: string[];
}

/**
 * Resolves a domain's NS records and matches them against known provider
 * nameserver patterns. Returns `provider: null` (never throws) for any
 * domain that doesn't resolve, has no NS records yet, or is hosted by a
 * provider we don't have an integration for — all of which are normal,
 * expected outcomes here, not errors.
 */
export async function detectDnsProvider(domainName: string): Promise<DetectedDnsProvider> {
  let nameservers: string[] = [];
  try {
    nameservers = await resolveNs(domainName);
  } catch {
    return { provider: null, nameservers: [] };
  }

  for (const { provider, pattern } of PROVIDER_NS_PATTERNS) {
    if (nameservers.some((ns) => pattern.test(ns))) {
      return { provider, nameservers };
    }
  }
  return { provider: null, nameservers };
}
