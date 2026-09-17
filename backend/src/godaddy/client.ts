import https from 'https';
import { GoDaddyDomainInfo, GoDaddyDnsRecord } from './types';
import {
  GoDaddyError,
  GoDaddyUnavailableError,
  GoDaddyAuthError,
  GoDaddyDomainNotManagedError,
} from './errors';

// GoDaddy issues keys scoped to either the production API (api.godaddy.com)
// or the OTE/test sandbox (api.ote-godaddy.com) — a key from one will be
// rejected as invalid credentials by the other. Configurable so a key can be
// validated against OTE during development without touching real DNS.
const GODADDY_API_BASE = process.env.GODADDY_API_BASE_URL || 'https://api.godaddy.com';

/**
 * GoDaddy's SRV record schema requires `service` and `protocol` as separate
 * fields (e.g. "_imaps" / "_tcp") rather than accepting them folded into
 * `name` the way BIND zone files (and this codebase's internal record
 * model) do — a bare SRV record name is always `_service._protocol`, so
 * these are always derivable rather than something the caller must supply.
 * Missing them is exactly GoDaddy's "Missing record information, [protocol]"
 * 422 error.
 */
function deriveSrvServiceProtocol(name: string): { service: string; protocol: string } | null {
  const match = name.match(/^(_[^.]+)\.(_[^.]+)$/);
  if (!match) return null;
  return { service: match[1], protocol: match[2] };
}

export class GoDaddyClient {
  /**
   * Low-level dispatch mirroring backend/src/stalwart/client.ts's `dispatch`
   * shape/conventions (raw Node https, explicit status-code handling, typed
   * errors) so the two third-party integrations in this codebase read the
   * same way.
   */
  private async request(
    method: 'GET' | 'PATCH' | 'PUT',
    path: string,
    apiKey: string,
    apiSecret: string,
    body?: unknown
  ): Promise<{ status: number; json: any }> {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const url = new URL(`${GODADDY_API_BASE}${path}`);

    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method,
          timeout: 10000,
          headers: {
            'Authorization': `sso-key ${apiKey}:${apiSecret}`,
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            const status = res.statusCode || 0;
            if (status >= 500) {
              return reject(new GoDaddyUnavailableError(`GoDaddy server error: HTTP ${status}`, body));
            }
            let json: any = null;
            if (body) {
              try {
                json = JSON.parse(body);
              } catch {
                // GoDaddy returns an empty body on some successful PATCH calls; non-JSON is only an error on non-2xx.
                if (status >= 400) {
                  return reject(new GoDaddyError(`Invalid JSON response from GoDaddy: HTTP ${status}`, 'PROTOCOL_ERROR', body));
                }
              }
            }
            resolve({ status, json });
          });
        }
      );

      req.on('error', (err) => {
        reject(new GoDaddyUnavailableError(`Unable to reach GoDaddy API: ${err.message}`));
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new GoDaddyUnavailableError('GoDaddy API request timed out'));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  /**
   * Confirms the supplied credential is valid AND actually manages the given
   * domain, before Toowix ever stores it. Throws GoDaddyAuthError for bad
   * credentials, GoDaddyDomainNotManagedError if the credential is valid but
   * this domain isn't in that GoDaddy account.
   */
  async verifyCredential(apiKey: string, apiSecret: string, domain: string): Promise<GoDaddyDomainInfo> {
    const normalized = domain.trim().toLowerCase();
    const { status, json } = await this.request('GET', `/v1/domains/${encodeURIComponent(normalized)}`, apiKey, apiSecret);

    if (status === 401 || status === 403) {
      throw new GoDaddyAuthError(undefined, json);
    }
    if (status === 404) {
      throw new GoDaddyDomainNotManagedError(normalized, json);
    }
    if (status >= 400) {
      throw new GoDaddyError(`GoDaddy rejected the credential check: HTTP ${status}`, 'GODADDY_VERIFY_FAILED', json);
    }

    return {
      domain: json?.domain || normalized,
      domainId: json?.domainId,
      status: json?.status,
    };
  }

  /**
   * Lists existing DNS records of one type+name (e.g. MX/@ or TXT/@) so the
   * activation orchestrator can detect a conflict before creating anything.
   * GoDaddy returns 404 when no records of that type/name exist yet — this
   * is treated as "no conflict", not an error.
   */
  async listDnsRecords(
    apiKey: string,
    apiSecret: string,
    domain: string,
    type: string,
    name: string
  ): Promise<GoDaddyDnsRecord[]> {
    const normalized = domain.trim().toLowerCase();
    const { status, json } = await this.request(
      'GET',
      `/v1/domains/${encodeURIComponent(normalized)}/records/${type}/${encodeURIComponent(name)}`,
      apiKey,
      apiSecret
    );

    if (status === 404) return [];
    if (status === 401 || status === 403) {
      throw new GoDaddyAuthError(undefined, json);
    }
    if (status >= 400) {
      throw new GoDaddyError(`Failed to list DNS records: HTTP ${status}`, 'GODADDY_LIST_FAILED', json);
    }
    return Array.isArray(json) ? json : [];
  }

  /**
   * Additively creates DNS records (GoDaddy's PATCH /records appends rather
   * than replacing existing records of the same type/name — this is the
   * behavior the "never overwrite a conflicting record" requirement needs;
   * conflicts must be checked with listDnsRecords() BEFORE calling this).
   */
  async createDnsRecords(
    apiKey: string,
    apiSecret: string,
    domain: string,
    records: GoDaddyDnsRecord[]
  ): Promise<void> {
    const normalized = domain.trim().toLowerCase();
    const { status, json } = await this.request(
      'PATCH',
      `/v1/domains/${encodeURIComponent(normalized)}/records`,
      apiKey,
      apiSecret,
      records.map((r) => ({
        type: r.type,
        name: r.name,
        data: r.data,
        ttl: r.ttl ?? 3600,
        ...(r.priority != null ? { priority: r.priority } : {}),
        ...(r.type === 'SRV'
          ? { weight: r.weight ?? 1, port: r.port ?? 0, ...(deriveSrvServiceProtocol(r.name) || { service: r.service, protocol: r.protocol }) }
          : {}),
        ...(r.type === 'CAA' ? { flags: r.flags ?? 0, tag: r.tag ?? 'issue' } : {}),
      }))
    );

    if (status === 401 || status === 403) {
      throw new GoDaddyAuthError(undefined, json);
    }
    if (status >= 400) {
      throw new GoDaddyError(`Failed to create DNS records: HTTP ${status}`, 'GODADDY_CREATE_FAILED', json);
    }
  }

  /**
   * Fully replaces the record set at one (type, name) — GoDaddy's PUT
   * /records/{type}/{name} endpoint, unlike PATCH /records above, overwrites
   * the entire group rather than appending. Used to resolve a conflict:
   * the caller passes the full desired final set (any foreign records the
   * caller wants preserved at this same type+name, plus Toowix's own value),
   * so this never silently drops something unrelated living at the same
   * name (e.g. a google-site-verification TXT record next to our SPF one).
   */
  async replaceDnsRecordGroup(
    apiKey: string,
    apiSecret: string,
    domain: string,
    type: string,
    name: string,
    records: Array<{ data: string; ttl?: number; priority?: number | null; weight?: number | null; port?: number | null; flags?: number | null; tag?: string | null }>
  ): Promise<void> {
    const normalized = domain.trim().toLowerCase();
    const { status, json } = await this.request(
      'PUT',
      `/v1/domains/${encodeURIComponent(normalized)}/records/${type}/${encodeURIComponent(name)}`,
      apiKey,
      apiSecret,
      records.map((r) => ({
        data: r.data,
        ttl: r.ttl ?? 3600,
        ...(type === 'MX' && r.priority != null ? { priority: r.priority } : {}),
        ...(type === 'SRV'
          ? { priority: r.priority ?? 0, weight: r.weight ?? 1, port: r.port ?? 0, ...(deriveSrvServiceProtocol(name) || {}) }
          : {}),
        ...(type === 'CAA' ? { flags: r.flags ?? 0, tag: r.tag ?? 'issue' } : {}),
      }))
    );

    if (status === 401 || status === 403) {
      throw new GoDaddyAuthError(undefined, json);
    }
    if (status >= 400) {
      throw new GoDaddyError(`Failed to replace DNS records: HTTP ${status}`, 'GODADDY_REPLACE_FAILED', json);
    }
  }
}

export const goDaddyClient = new GoDaddyClient();
