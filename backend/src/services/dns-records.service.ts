import { StalwartDkimKey, StalwartDkimAlgorithm } from '../stalwart/types';
import { IGeneratedDnsRecord } from '../db/models/Domain';

/**
 * Builds the canonical, real DNS record set a tenant must publish for mail
 * to work — replacing the old hardcoded/fake placeholder that used to live
 * inline in tenant.routes.ts. DKIM records come from Stalwart's actual
 * auto-generated keys (see docs/STALWART_API_NOTES.md §7); MX/SPF/DMARC use
 * Toowix's own canonical policy rather than Stalwart's harsher auto-defaults
 * (Stalwart's own zone file uses `-all` SPF and immediate `p=reject` DMARC,
 * which are too strict to hand a brand-new customer domain — see §7C of
 * that doc for the full discrepancy writeup).
 *
 * This canonical policy is also documented for customers in
 * docs/DOMAIN_SETUP_GUIDE.md — keep the two in sync if either changes.
 */

const DKIM_ALGORITHM_LABEL: Record<StalwartDkimAlgorithm, string> = {
  Dkim1RsaSha256: 'rsa',
  Dkim1Ed25519Sha256: 'ed25519',
};

export function buildRequiredDnsRecords(domainName: string, dkimKeys: StalwartDkimKey[]): IGeneratedDnsRecord[] {
  const records: IGeneratedDnsRecord[] = [];

  records.push({
    type: 'MX',
    name: '@',
    value: 'mail.toowix.com',
    priority: 10,
    ttl: 3600,
    purpose: 'Primary Mail Routing Exchange',
  });

  records.push({
    type: 'TXT',
    name: '@',
    value: 'v=spf1 mx include:_spf.toowix.com ~all',
    ttl: 3600,
    purpose: 'Sender Policy Framework (SPF)',
  });

  for (const key of dkimKeys) {
    const algoLabel = DKIM_ALGORITHM_LABEL[key.algorithm] || key.algorithm.toLowerCase();
    records.push({
      type: 'TXT',
      name: `${key.selector}._domainkey`,
      value: `v=DKIM1; k=${algoLabel}; p=${key.publicKey}`,
      ttl: 3600,
      purpose: `DomainKeys Identified Mail (DKIM — ${algoLabel.toUpperCase()})`,
    });
  }

  records.push({
    type: 'TXT',
    name: '_dmarc',
    // Progressive rollout: start at p=none (monitor-only) for a newly activated
    // domain rather than quarantine/reject, to avoid silently dropping a new
    // customer's legitimate mail before they've confirmed SPF/DKIM alignment.
    value: `v=DMARC1; p=none; rua=mailto:dmarc-reports@${domainName}`,
    ttl: 3600,
    purpose: 'Domain-based Message Authentication Reporting (DMARC)',
  });

  return records;
}
