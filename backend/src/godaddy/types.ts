export interface GoDaddyDomainInfo {
  domain: string;
  domainId: number;
  status: string;
}

export type GoDaddyRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS' | 'CAA';

export interface GoDaddyDnsRecord {
  type: GoDaddyRecordType;
  name: string;
  data: string;
  ttl?: number;
  priority?: number;
}
