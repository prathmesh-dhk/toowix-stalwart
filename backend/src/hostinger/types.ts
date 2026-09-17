export interface HostingerZoneRecordValue {
  content: string;
  isDisabled?: boolean;
}

/** One name+type group as returned by GET /api/dns/v1/zones/{domain}. */
export interface HostingerZoneRecordGroup {
  name: string;
  type: string;
  ttl: number;
  records: HostingerZoneRecordValue[];
}

/** A single flattened record, in the same shape used by the rest of this
 * codebase's DNS-record handling (see godaddy/types.ts). MX priority is
 * embedded in `data` (Hostinger has no separate priority field — see
 * hostinger/client.ts for the "<priority> <target>" encoding). */
export type HostingerRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS' | 'CAA';

export interface HostingerDnsRecord {
  type: HostingerRecordType;
  name: string;
  data: string;
  ttl?: number;
  // SRV-specific (Hostinger has no dedicated fields for these either — see
  // hostinger/client.ts's content encode/decode)
  priority?: number | null;
  weight?: number | null;
  port?: number | null;
  // CAA-specific
  flags?: number | null;
  tag?: string | null;
}
