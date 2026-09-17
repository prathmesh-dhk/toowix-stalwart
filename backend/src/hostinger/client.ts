import https from 'https';
import { HostingerZoneRecordGroup, HostingerDnsRecord } from './types';
import {
  HostingerError,
  HostingerUnavailableError,
  HostingerAuthError,
  HostingerDomainNotManagedError,
} from './errors';

// Verified against Hostinger's official PHP SDK docs (hostinger/api-php-sdk,
// DNSZoneApi + DNSV1Zone* models) — see docs/STALWART_API_NOTES.md-adjacent
// research notes in the domain-activation plan for the trail. Key facts:
//  - Auth: `Authorization: Bearer <token>` (token generated in hPanel).
//  - GET  /api/dns/v1/zones/{domain}  -> DNSV1ZoneRecordResource[]
//        [{ name, type, ttl, records: [{ content, isDisabled }] }]
//  - PUT  /api/dns/v1/zones/{domain}  body: { overwrite: bool, zone: [...] }
//        `overwrite` DEFAULTS TO TRUE server-side if omitted, which deletes
//        and replaces matching name+type records — this client always sends
//        `overwrite: false` explicitly (update ttl/append new, never wipe).
//  - No dedicated MX priority field; priority is encoded directly in
//    `content` as "<priority> <target>", per DNS zone-file convention.
//    Hostinger has no structured fields for SRV/CAA either (each record is
//    just `{content, isDisabled}`), so those are encoded/decoded the same
//    zone-file way: SRV as "<priority> <weight> <port> <target>", CAA as
//    "<flags> <tag> <value>".
const HOSTINGER_API_BASE = process.env.HOSTINGER_API_BASE_URL || 'https://developers.hostinger.com';

/** Encodes a structured record into Hostinger's single `content` string. */
function encodeContent(type: string, r: { data: string; priority?: number | null; weight?: number | null; port?: number | null; flags?: number | null; tag?: string | null }): string {
  if (type === 'MX' && r.priority != null) {
    return `${r.priority} ${r.data}`;
  }
  if (type === 'SRV') {
    return `${r.priority ?? 0} ${r.weight ?? 1} ${r.port ?? 0} ${r.data}`;
  }
  if (type === 'CAA') {
    return `${r.flags ?? 0} ${r.tag ?? 'issue'} ${r.data}`;
  }
  return r.data;
}

/** Decodes Hostinger's `content` string back into structured fields. */
function decodeContent(type: string, content: string): { data: string; priority?: number; weight?: number; port?: number; flags?: number; tag?: string } {
  if (type === 'MX') {
    const m = content.match(/^(\d+)\s+(.+)$/);
    if (m) return { data: m[2], priority: parseInt(m[1], 10) };
  }
  if (type === 'SRV') {
    const m = content.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (m) return { data: m[4], priority: parseInt(m[1], 10), weight: parseInt(m[2], 10), port: parseInt(m[3], 10) };
  }
  if (type === 'CAA') {
    const m = content.match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (m) return { data: m[3].replace(/^"|"$/g, ''), flags: parseInt(m[1], 10), tag: m[2] };
  }
  return { data: content };
}

export class HostingerClient {
  private async request(
    method: 'GET' | 'PUT',
    path: string,
    token: string,
    body?: unknown
  ): Promise<{ status: number; json: any }> {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const url = new URL(`${HOSTINGER_API_BASE}${path}`);

    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method,
          timeout: 10000,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let respBody = '';
          res.on('data', (chunk) => (respBody += chunk));
          res.on('end', () => {
            const status = res.statusCode || 0;
            if (status >= 500) {
              return reject(new HostingerUnavailableError(`Hostinger server error: HTTP ${status}`, respBody));
            }
            let json: any = null;
            if (respBody) {
              try {
                json = JSON.parse(respBody);
              } catch {
                if (status >= 400) {
                  return reject(new HostingerError(`Invalid JSON response from Hostinger: HTTP ${status}`, 'PROTOCOL_ERROR', respBody));
                }
              }
            }
            resolve({ status, json });
          });
        }
      );

      req.on('error', (err) => {
        reject(new HostingerUnavailableError(`Unable to reach Hostinger API: ${err.message}`));
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new HostingerUnavailableError('Hostinger API request timed out'));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  private async getZone(token: string, domain: string): Promise<HostingerZoneRecordGroup[]> {
    const { status, json } = await this.request('GET', `/api/dns/v1/zones/${encodeURIComponent(domain)}`, token);

    if (status === 401 || status === 403) {
      throw new HostingerAuthError(undefined, json);
    }
    if (status === 404) {
      throw new HostingerDomainNotManagedError(domain, json);
    }
    if (status >= 400) {
      throw new HostingerError(`Failed to read DNS zone: HTTP ${status}`, 'HOSTINGER_GET_ZONE_FAILED', json);
    }
    return Array.isArray(json) ? json : [];
  }

  /**
   * Confirms the token is valid AND actually manages the given domain, by
   * attempting to read its zone (Hostinger has no separate "verify" call).
   */
  async verifyCredential(token: string, domain: string): Promise<{ domain: string }> {
    const normalized = domain.trim().toLowerCase();
    await this.getZone(token, normalized);
    return { domain: normalized };
  }

  /**
   * Lists existing records at one (type, name) so the activation
   * orchestrator can detect a conflict before creating anything. Hostinger
   * only exposes a whole-zone GET, so this fetches the full zone and
   * filters client-side.
   */
  async listDnsRecords(
    token: string,
    domain: string,
    type: string,
    name: string
  ): Promise<HostingerDnsRecord[]> {
    const normalized = domain.trim().toLowerCase();
    const zone = await this.getZone(token, normalized);
    const group = zone.find((g) => g.type === type && normalizeName(g.name) === normalizeName(name));
    if (!group) return [];
    return group.records.map((r) => ({ type: type as any, name, ttl: group.ttl, ...decodeContent(type, r.content) }));
  }

  /**
   * Additively creates/updates DNS records. Always sends `overwrite: false`
   * — Hostinger's own default (true) would delete-and-replace matching
   * name+type groups, which this codebase's "never overwrite a conflict"
   * rule forbids. Conflicts must be checked with listDnsRecords() first.
   */
  async createDnsRecords(
    token: string,
    domain: string,
    records: Array<{ type: string; name: string; data: string; ttl?: number; priority?: number | null; weight?: number | null; port?: number | null; flags?: number | null; tag?: string | null }>
  ): Promise<void> {
    const normalized = domain.trim().toLowerCase();
    const zone = records.map((r) => ({
      name: r.name,
      type: r.type,
      ttl: r.ttl ?? 3600,
      records: [{ content: encodeContent(r.type, r) }],
    }));

    const { status, json } = await this.request('PUT', `/api/dns/v1/zones/${encodeURIComponent(normalized)}`, token, {
      overwrite: false,
      zone,
    });

    if (status === 401 || status === 403) {
      throw new HostingerAuthError(undefined, json);
    }
    if (status >= 400) {
      throw new HostingerError(`Failed to create DNS records: HTTP ${status}`, 'HOSTINGER_CREATE_FAILED', json);
    }
  }

  /**
   * Fully replaces the record set at one (type, name) group by sending
   * `overwrite: true` scoped to just that single group — Hostinger only
   * deletes/replaces the exact name+type groups present in the payload,
   * leaving every other group in the zone untouched. The caller passes the
   * full desired final set (any foreign records to preserve within this
   * group, plus Toowix's own value) so nothing unrelated is lost.
   */
  async replaceDnsRecordGroup(
    token: string,
    domain: string,
    type: string,
    name: string,
    records: Array<{ data: string; ttl?: number; priority?: number | null; weight?: number | null; port?: number | null; flags?: number | null; tag?: string | null }>
  ): Promise<void> {
    const normalized = domain.trim().toLowerCase();
    const zone = [
      {
        name,
        type,
        ttl: records[0]?.ttl ?? 3600,
        records: records.map((r) => ({
          content: encodeContent(type, r),
        })),
      },
    ];

    const { status, json } = await this.request('PUT', `/api/dns/v1/zones/${encodeURIComponent(normalized)}`, token, {
      overwrite: true,
      zone,
    });

    if (status === 401 || status === 403) {
      throw new HostingerAuthError(undefined, json);
    }
    if (status >= 400) {
      throw new HostingerError(`Failed to replace DNS records: HTTP ${status}`, 'HOSTINGER_REPLACE_FAILED', json);
    }
  }
}

function normalizeName(name: string): string {
  const n = name.trim().toLowerCase();
  return n === '' ? '@' : n;
}

export const hostingerClient = new HostingerClient();
