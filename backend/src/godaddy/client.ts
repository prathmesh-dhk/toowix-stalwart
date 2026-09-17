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
 * GoDaddy's SRV record schema requires `service` (e.g. "_imaps") and `protocol`
 * ("_tcp") as separate fields rather than accepting them folded into `name` the
 * way BIND zone files and standard DNS models do.
 * Furthermore, GoDaddy constructs the published FQDN as `${service}.${protocol}.${name}.${domain}`.
 * Therefore, for root-domain SRV records, `name` must be "@" (or the subdomain if scoped).
 * If `name` were kept as "_imaps._tcp", GoDaddy would publish it as "_imaps._tcp._imaps._tcp.domain.com".
 */
export function deriveSrv(name: string): { service: string; protocol: string; godaddyName: string } | null {
  const match = name.match(/^(_[^.]+)\.(_[^.]+)(?:\.(.+))?$/);
  if (!match) return null;
  return {
    service: match[1],
    protocol: match[2],
    godaddyName: match[3] && match[3] !== '@' ? match[3] : '@',
  };
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

    if (type === 'SRV') {
      const srv = deriveSrv(name);
      const godaddyName = srv?.godaddyName ?? name;
      const { status, json } = await this.request(
        'GET',
        `/v1/domains/${encodeURIComponent(normalized)}/records/SRV/${encodeURIComponent(godaddyName)}`,
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
      if (!Array.isArray(json)) return [];
      if (srv) {
        return json.filter(
          (r: any) =>
            r.service?.toLowerCase() === srv.service.toLowerCase() &&
            r.protocol?.toLowerCase() === srv.protocol.toLowerCase()
        );
      }
      return json;
    }

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
      records.map((r) => {
        const srv = r.type === 'SRV' ? deriveSrv(r.name) : null;
        return {
          type: r.type,
          name: srv ? srv.godaddyName : r.name,
          data: r.data,
          ttl: r.ttl ?? 3600,
          ...(r.priority != null ? { priority: r.priority } : {}),
          ...(r.type === 'SRV'
            ? {
                weight: r.weight ?? 1,
                port: r.port ?? 0,
                service: srv?.service || r.service,
                protocol: srv?.protocol || r.protocol,
              }
            : {}),
          ...(r.type === 'CAA' ? { flags: r.flags ?? 0, tag: r.tag ?? 'issue' } : {}),
        };
      })
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

    if (type === 'SRV') {
      const srv = deriveSrv(name);
      const godaddyName = srv?.godaddyName ?? (name === '@' || !name ? '@' : name);
      // Fetch all existing SRV records so we don't accidentally wipe out other SRV services at the same name
      const { status: listStatus, json: listJson } = await this.request(
        'GET',
        `/v1/domains/${encodeURIComponent(normalized)}/records/SRV`,
        apiKey,
        apiSecret
      );
      if (listStatus === 401 || listStatus === 403) {
        throw new GoDaddyAuthError(undefined, listJson);
      }
      if (listStatus >= 400 && listStatus !== 404) {
        throw new GoDaddyError(`Failed to fetch SRV records: HTTP ${listStatus}`, 'GODADDY_LIST_FAILED', listJson);
      }

      const existingRecords: any[] = Array.isArray(listJson) ? listJson : [];
      // Keep records that do NOT match this service + protocol + name
      const preserved = existingRecords.filter((r) => {
        if (!srv) return (r.name || '@').toLowerCase() !== godaddyName.toLowerCase();
        const matchService = r.service?.toLowerCase() === srv.service.toLowerCase();
        const matchProtocol = r.protocol?.toLowerCase() === srv.protocol.toLowerCase();
        const matchName = (r.name || '@').toLowerCase() === godaddyName.toLowerCase();
        return !(matchService && matchProtocol && matchName);
      });

      const newSrvRecords = records.map((r) => ({
        type: 'SRV',
        name: godaddyName,
        data: r.data,
        ttl: r.ttl ?? 3600,
        priority: r.priority ?? 0,
        weight: r.weight ?? 1,
        port: r.port ?? 0,
        ...(srv ? { service: srv.service, protocol: srv.protocol } : {}),
      }));

      const payload = [...preserved, ...newSrvRecords];
      const { status, json } = await this.request(
        'PUT',
        `/v1/domains/${encodeURIComponent(normalized)}/records/SRV`,
        apiKey,
        apiSecret,
        payload
      );

      if (status === 401 || status === 403) {
        throw new GoDaddyAuthError(undefined, json);
      }
      if (status >= 400) {
        throw new GoDaddyError(`Failed to replace SRV records: HTTP ${status}`, 'GODADDY_REPLACE_FAILED', json);
      }
      return;
    }

    const { status, json } = await this.request(
      'PUT',
      `/v1/domains/${encodeURIComponent(normalized)}/records/${type}/${encodeURIComponent(name)}`,
      apiKey,
      apiSecret,
      records.map((r) => ({
        data: r.data,
        ttl: r.ttl ?? 3600,
        ...(type === 'MX' && r.priority != null ? { priority: r.priority } : {}),
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
