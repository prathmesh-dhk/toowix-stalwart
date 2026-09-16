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
  /**
   * Cleans user-supplied tokens by removing surrounding quotes, whitespace,
   * and accidental "Bearer " prefixes.
   */
  private sanitizeToken(token: string): string {
    if (!token) return '';
    return token
      .trim()
      .replace(/^['"]+|['"]+$/g, '')
      .replace(/^bearer\s+/i, '')
      .trim();
  }

  private extractErrorMessage(json: any, fallback: string): string {
    const cfError = json?.errors?.[0];
    const subError = cfError?.error_chain?.[0];
    return subError?.message || cfError?.message || fallback;
  }

  private isAuthError(status: number, json: any): boolean {
    if (status === 401 || status === 403) return true;
    if (status === 400) {
      const cfError = json?.errors?.[0];
      const subError = cfError?.error_chain?.[0];
      const code = cfError?.code;
      const subCode = subError?.code;
      const msg = `${cfError?.message || ''} ${subError?.message || ''}`.toLowerCase();
      return (
        code === 6003 ||
        code === 6111 ||
        code === 9106 ||
        code === 9107 ||
        code === 9109 ||
        code === 10000 ||
        subCode === 6111 ||
        msg.includes('authorization') ||
        msg.includes('token') ||
        msg.includes('header') ||
        msg.includes('auth')
      );
    }
    return false;
  }

  private formatAuthErrorMessage(json: any, token: string): string {
    const rawMsg = this.extractErrorMessage(json, '');
    const cleanTok = this.sanitizeToken(token);

    // Common user mistake: pasting a 37-character hexadecimal Global API Key instead of an API Token
    if (/^[a-f0-9]{37}$/i.test(cleanTok)) {
      return 'You entered a Global API Key. Cloudflare requires an API Token created with the "Edit zone DNS" template (with Zone:DNS:Edit and Zone:Zone:Read permissions).';
    }

    if (rawMsg) {
      if (/permission|requires/i.test(rawMsg)) {
        return `Cloudflare permission error: ${rawMsg}. Make sure the token has both 'Zone: DNS: Edit' and 'Zone: Zone: Read' permissions.`;
      }
      return `Cloudflare authentication error: ${rawMsg}`;
    }

    return 'Invalid or expired Cloudflare API token. Ensure it has "Zone: DNS: Edit" and "Zone: Zone: Read" permissions for this domain.';
  }

  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    token: string,
    body?: unknown
  ): Promise<{ status: number; json: any }> {
    const cleanToken = this.sanitizeToken(token);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const url = new URL(`${CLOUDFLARE_API_BASE}${path}`);

    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method,
          timeout: 10000,
          headers: {
            'Authorization': `Bearer ${cleanToken}`,
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
    const { status, json } = await this.request('GET', `/zones?name=${encodeURIComponent(normalized)}`, token);

    if (this.isAuthError(status, json)) {
      throw new CloudflareAuthError(this.formatAuthErrorMessage(json, token), json);
    }
    if (status >= 400 || json?.success === false) {
      const msg = this.extractErrorMessage(json, `Failed to look up Cloudflare zone: HTTP ${status}`);
      throw new CloudflareError(msg, 'CLOUDFLARE_ZONE_LOOKUP_FAILED', json);
    }

    const zones: any[] = Array.isArray(json?.result) ? json.result : [];
    let zone = zones.find((z) => z.name.toLowerCase() === normalized);

    // If not found and domain might be a subdomain (e.g. mail.domain.com), check apex domain
    if (!zone && normalized.split('.').length > 2) {
      const parts = normalized.split('.');
      const apex = parts.slice(-2).join('.');
      const apexRes = await this.request('GET', `/zones?name=${encodeURIComponent(apex)}`, token);
      if (apexRes.status === 200 && Array.isArray(apexRes.json?.result)) {
        zone = apexRes.json.result.find((z: any) => z.name.toLowerCase() === apex);
      }
    }

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
  ): Promise<Array<{ type: string; name: string; data: string; ttl?: number; priority?: number; id?: string }>> {
    const normalized = domain.trim().toLowerCase();
    const zone = await this.resolveZone(token, normalized);
    const fqdn = this.fqdn(normalized, name);

    const { status, json } = await this.request(
      'GET',
      `/zones/${zone.id}/dns_records?type=${encodeURIComponent(type)}&name=${encodeURIComponent(fqdn)}`,
      token
    );

    if (this.isAuthError(status, json)) {
      throw new CloudflareAuthError(this.formatAuthErrorMessage(json, token), json);
    }
    if (status >= 400 || json?.success === false) {
      const msg = this.extractErrorMessage(json, `Failed to list DNS records: HTTP ${status}`);
      throw new CloudflareError(msg, 'CLOUDFLARE_LIST_FAILED', json);
    }
    const records = Array.isArray(json?.result) ? json.result : [];
    return records.map((r: any) => ({ type, name, data: r.content, ttl: r.ttl, priority: r.priority, id: r.id }));
  }

  /**
   * Additively creates DNS records — Cloudflare's create endpoint makes one
   * brand-new record per call and never touches existing ones.
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

      if (this.isAuthError(status, json)) {
        throw new CloudflareAuthError(this.formatAuthErrorMessage(json, token), json);
      }
      if (status >= 400 || json?.success === false) {
        const msg = this.extractErrorMessage(json, `Failed to create DNS record ${r.type} ${r.name}: HTTP ${status}`);
        throw new CloudflareError(msg, 'CLOUDFLARE_CREATE_FAILED', json);
      }
    }
  }

  private async deleteDnsRecord(token: string, zoneId: string, recordId: string): Promise<void> {
    const { status, json } = await this.request('DELETE', `/zones/${zoneId}/dns_records/${recordId}`, token);
    if (this.isAuthError(status, json)) {
      throw new CloudflareAuthError(this.formatAuthErrorMessage(json, token), json);
    }
    if (status >= 400 || json?.success === false) {
      const msg = this.extractErrorMessage(json, `Failed to delete DNS record: HTTP ${status}`);
      throw new CloudflareError(msg, 'CLOUDFLARE_DELETE_FAILED', json);
    }
  }

  /**
   * Cloudflare has no atomic "replace this group" endpoint (unlike GoDaddy's
   * PUT-by-type-name or Hostinger's scoped overwrite) — multiple records can
   * coexist at the same (type, name), which is normal DNS there, not a
   * conflict. So this synchronizes the group to the caller's desired final
   * set by diffing: existing records whose value doesn't match anything in
   * `records` are deleted one-by-one, and desired values not already present
   * are created. A desired value already present is left untouched (and
   * never deleted+recreated), so unrelated records the caller chose to
   * preserve in `records` survive unless the network call itself fails.
   */
  async replaceDnsRecordGroup(
    token: string,
    domain: string,
    type: string,
    name: string,
    records: Array<{ data: string; ttl?: number; priority?: number | null }>
  ): Promise<void> {
    const normalized = domain.trim().toLowerCase();
    const zone = await this.resolveZone(token, normalized);
    const fqdn = this.fqdn(normalized, name);

    const { status, json } = await this.request(
      'GET',
      `/zones/${zone.id}/dns_records?type=${encodeURIComponent(type)}&name=${encodeURIComponent(fqdn)}`,
      token
    );
    if (this.isAuthError(status, json)) {
      throw new CloudflareAuthError(this.formatAuthErrorMessage(json, token), json);
    }
    if (status >= 400 || json?.success === false) {
      const msg = this.extractErrorMessage(json, `Failed to list DNS records: HTTP ${status}`);
      throw new CloudflareError(msg, 'CLOUDFLARE_LIST_FAILED', json);
    }
    const existing: Array<{ id: string; content: string }> = Array.isArray(json?.result) ? json.result : [];

    const normalize = (v: string) => v.trim().replace(/\.$/, '').replace(/\s+/g, ' ').toLowerCase();
    const desiredValues = new Set(records.map((r) => normalize(r.data)));
    const existingValues = new Set(existing.map((r) => normalize(r.content)));

    for (const e of existing) {
      if (!desiredValues.has(normalize(e.content))) {
        await this.deleteDnsRecord(token, zone.id, e.id);
      }
    }

    const toCreate = records.filter((r) => !existingValues.has(normalize(r.data)));
    if (toCreate.length > 0) {
      await this.createDnsRecords(
        token,
        normalized,
        toCreate.map((r) => ({ type, name, data: r.data, ttl: r.ttl, priority: r.priority }))
      );
    }
  }
}

export const cloudflareClient = new CloudflareClient();
