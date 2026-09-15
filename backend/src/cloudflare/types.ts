export type CloudflareRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS' | 'CAA';

/** One record as returned by GET /zones/{zone_id}/dns_records. */
export interface CloudflareDnsRecord {
  id: string;
  type: CloudflareRecordType;
  name: string; // full FQDN, e.g. "acme.com" or "_dmarc.acme.com" — never "@"
  content: string;
  ttl: number;
  priority?: number;
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
}
