import https from 'https';
import { CloudflareZone } from './types';
import {
  CloudflareError,
  CloudflareUnavailableError,
  CloudflareAuthError,
  CloudflareDomainNotManagedError,
} from './errors';

// Verified against Cloudflare's own API reference docs (developers.cloudflare.com,
// resources/zones + resources/dns/subresources/records). Key facts:
//  - Auth: `Authorization: Bearer <API Token>` (scoped "Edit zone DNS" template).
//  - Zones are looked up by domain name first (Cloudflare addresses everything
//    by an opaque zone_id, not the domain name itself): GET /zones?name.exact={domain}.
//  - GET  /zones/{zone_id}/dns_records?type=X&name.exact=Y  -> list (each record
//    has its own `id`; multiple records can coexist at the same name+type — this
//    is normal DNS, not a conflict, unlike Hostinger's grouped-by-name+type model).
//  - POST /zones/{zone_id}/dns_records  body: {type, name (FULL FQDN, not "@"),
//    content, ttl, priority?} creates exactly ONE new record and never touches
//    any existing one — the safest of the three providers' write semantics,
//    no overwrite flag needed at all.
//  - MX priority is a genuine top-level `priority` field (unlike Hostinger,
//    which encodes it into the content string).
const CLOUDFLARE_API_BASE = process.env.CLOUDFLARE_API_BASE_URL || 'https://api.cloudflare.com/client/v4';

export class CloudflareClient {
  private async request(
    method: 'GET' | 'POST',
    path: string,
    token: string,
    body?: unknown
  ): Promise<{ status: number; json: any }> {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const url = new URL(`${CLOUDFLARE_API_BASE}${path}`);

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
              return reject(new CloudflareUnavailableError(`Cloudflare server error: HTTP ${status}`, respBody));
            }
            let json: any = null;
            if (respBody) {
              try {
                json = JSON.parse(respBody);
              } catch {
                if (status >= 400) {
                  return reject(new CloudflareError(`Invalid JSON response from Cloudflare: HTTP ${status}`, 'PROTOCOL_ERROR', respBody));
                }
              }
            }
            resolve({ status, json });
          });
        }
      );

      req.on('error', (err) => {
        reject(new CloudflareUnavailableError(`Unable to reach Cloudflare API: ${err.message}`));
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new CloudflareUnavailableError('Cloudflare API request timed out'));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  private async resolveZone(token: string, domain: string): Promise<CloudflareZone> {
    const normalized = domain.trim().toLowerCase();
    const { status, json } = await this.request('GET', `/zones?name.exact=${encodeURIComponent(normalized)}`, token);

    if (status === 401 || status === 403) {
      throw new CloudflareAuthError(undefined, json);
    }
    if (status >= 400 || json?.success === false) {
      throw new CloudflareError(`Failed to look up Cloudflare zone: HTTP ${status}`, 'CLOUDFLARE_ZONE_LOOKUP_FAILED', json);
    }
    const zone = json?.result?.[0];
    if (!zone) {
      throw new CloudflareDomainNotManagedError(normalized, json);
    }
    return { id: zone.id, name: zone.name, status: zone.status };
  }

  private fqdn(domain: string, name: string): string {
    return name === '@' ? domain : `${name}.${domain}`;
  }

  /** Confirms the token is valid AND actually manages the given domain. */
  async verifyCredential(token: string, domain: string): Promise<{ domain: string }> {
    const zone = await this.resolveZone(token, domain);
    return { domain: zone.name };
  }

  /**
   * Lists existing records at one (type, name) so the activation
   * orchestrator can detect a conflict before creating anything.
   */
  async listDnsRecords(
    token: string,
    domain: string,
    type: string,
    name: string
  ): Promise<Array<{ type: string; name: string; data: string; ttl?: number; priority?: number }>> {
    const normalized = domain.trim().toLowerCase();
    const zone = await this.resolveZone(token, normalized);
    const fqdn = this.fqdn(normalized, name);

    const { status, json } = await this.request(
      'GET',
      `/zones/${zone.id}/dns_records?type=${encodeURIComponent(type)}&name.exact=${encodeURIComponent(fqdn)}`,
      token
    );

    if (status === 401 || status === 403) {
      throw new CloudflareAuthError(undefined, json);
    }
    if (status >= 400 || json?.success === false) {
      throw new CloudflareError(`Failed to list DNS records: HTTP ${status}`, 'CLOUDFLARE_LIST_FAILED', json);
    }
    const records = Array.isArray(json?.result) ? json.result : [];
    return records.map((r: any) => ({ type, name, data: r.content, ttl: r.ttl, priority: r.priority }));
  }

  /**
   * Additively creates DNS records — Cloudflare's create endpoint makes one
   * brand-new record per call and never touches existing ones, so unlike
   * GoDaddy/Hostinger there is no overwrite flag to worry about. Conflicts
   * must still be checked with listDnsRecords() first (this codebase's own
   * "never overwrite a conflict" rule, not a Cloudflare API requirement).
   */
  async createDnsRecords(
    token: string,
    domain: string,
    records: Array<{ type: string; name: string; data: string; ttl?: number; priority?: number | null }>
  ): Promise<void> {
    const normalized = domain.trim().toLowerCase();
    const zone = await this.resolveZone(token, normalized);

    for (const r of records) {
      const { status, json } = await this.request('POST', `/zones/${zone.id}/dns_records`, token, {
        type: r.type,
        name: this.fqdn(normalized, r.name),
        content: r.data,
        ttl: r.ttl ?? 3600,
        ...(r.type === 'MX' && r.priority != null ? { priority: r.priority } : {}),
      });

      if (status === 401 || status === 403) {
        throw new CloudflareAuthError(undefined, json);
      }
      if (status >= 400 || json?.success === false) {
        throw new CloudflareError(`Failed to create DNS record ${r.type} ${r.name}: HTTP ${status}`, 'CLOUDFLARE_CREATE_FAILED', json);
      }
    }
  }
}

export const cloudflareClient = new CloudflareClient();
