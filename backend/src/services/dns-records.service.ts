import { config } from '../config';
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
  const mailHost = config.mailHostname || 'mail.toowix.com';
  const ips = (config.mailServerIps || '103.13.114.138 103.13.114.227')
    .split(/\s+/)
    .filter(Boolean)
    .map((ip) => `ip4:${ip}`)
    .join(' ');

  records.push({
    type: 'MX',
    name: '@',
    value: mailHost,
    priority: 10,
    ttl: 3600,
    purpose: 'Primary Mail Routing Exchange',
  });

  records.push({
    type: 'TXT',
    name: '@',
    value: `v=spf1 mx ${ips} ~all`,
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

/**
 * Parses Stalwart's raw BIND-style dnsZoneFile text into IGeneratedDnsRecord[],
 * replacing any `.test` hostname references with the real mail hostname
 * (e.g. `mail.toowix.test.` → `mail.toowix.com.`). The resulting records can
 * be merged with buildRequiredDnsRecords() output to produce the full set of
 * DNS records that includes autoconfig/autodiscover, SRV, MTA-STS, TLS-RPT,
 * CAA, and any other record types Stalwart generates.
 *
 * This function only extracts record types that can be published to DNS
 * providers (MX, TXT, CNAME, SRV, CAA). It handles Stalwart's multi-line
 * parenthesized TXT records (quoted strings split across lines).
 */
export function parseStalwartZoneFile(
  zoneFileText: string,
  domainName: string,
): IGeneratedDnsRecord[] {
  const mailHost = config.mailHostname || 'mail.toowix.com';
  // Replace all `.test.` hostnames with the real hostname. Stalwart uses
  // whatever server.hostname is configured; in our deploy it's `.test`.
  const fixedText = zoneFileText.replace(/mail\.toowix\.test/g, mailHost);

  const lines = fixedText.split('\n');
  const records: IGeneratedDnsRecord[] = [];

  // Handle multi-line parenthesized TXT records by joining lines inside parens
  const joinedLines: string[] = [];
  let pending = '';
  let inParen = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;

    if (inParen) {
      pending += ' ' + trimmed;
      if (trimmed.includes(')')) {
        inParen = false;
        joinedLines.push(pending);
        pending = '';
      }
    } else if (trimmed.includes('(') && !trimmed.includes(')')) {
      pending = trimmed;
      inParen = true;
    } else {
      joinedLines.push(trimmed);
    }
  }

  for (const line of joinedLines) {
    const parsed = parseZoneLine(line, domainName);
    if (parsed) records.push(parsed);
  }

  return records;
}

/**
 * Parses a single, fully-joined BIND zone line into an IGeneratedDnsRecord.
 * Returns null for unsupported record types.
 *
 * Examples of input:
 *   `dhkinnovation.com. IN MX 10 mail.toowix.com.`
 *   `_imaps._tcp.dhkinnovation.com. IN SRV 0 1 993 mail.toowix.com.`
 *   `dhkinnovation.com. IN CAA 0 issue "letsencrypt.org;accounturi=..."`
 *   `dhkinnovation.com. IN TXT "v=spf1 mx -all"`
 *   `autoconfig.dhkinnovation.com. IN CNAME mail.toowix.com.`
 *   `v1-rsa-20260916._domainkey.dhkinnovation.com. IN TXT ( "v=DKIM1; ..." "..." )`
 */
function parseZoneLine(line: string, domainName: string): IGeneratedDnsRecord | null {
  // Normalize: strip trailing dots from hostnames, collapse whitespace
  const normalized = line.replace(/\s+/g, ' ').trim();

  // Match: fqdn [ttl] IN <type> <rest>
  const match = normalized.match(
    /^(\S+?)\.?\s+(?:(\d+)\s+)?IN\s+(MX|TXT|CNAME|SRV|CAA)\s+(.+)$/i
  );
  if (!match) return null;

  const [, fqdn, ttlStr, recordType, rest] = match;
  const type = recordType.toUpperCase() as IGeneratedDnsRecord['type'];
  const ttl = ttlStr ? parseInt(ttlStr, 10) : 3600;
  const name = fqdnToRelative(fqdn, domainName);

  switch (type) {
    case 'MX': {
      // rest: "10 mail.toowix.com."
      const mxMatch = rest.match(/^(\d+)\s+(\S+?)\.?$/);
      if (!mxMatch) return null;
      return {
        type: 'MX',
        name,
        value: mxMatch[2],
        priority: parseInt(mxMatch[1], 10),
        ttl,
        purpose: 'Mail Routing Exchange',
      };
    }
    case 'TXT': {
      // rest: `"v=spf1 mx -all"` or `( "part1" "part2" )`
      const value = extractTxtValue(rest);
      if (!value) return null;
      return {
        type: 'TXT',
        name,
        value,
        ttl,
        purpose: guessTxtPurpose(name, value),
      };
    }
    case 'CNAME': {
      // rest: "mail.toowix.com."
      const target = rest.replace(/\.$/, '').trim();
      return {
        type: 'CNAME',
        name,
        value: target,
        ttl,
        purpose: guessCnamePurpose(name),
      };
    }
    case 'SRV': {
      // rest: "0 1 993 mail.toowix.com."
      const srvMatch = rest.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+?)\.?$/);
      if (!srvMatch) return null;
      return {
        type: 'SRV',
        name,
        value: srvMatch[4],
        priority: parseInt(srvMatch[1], 10),
        weight: parseInt(srvMatch[2], 10),
        port: parseInt(srvMatch[3], 10),
        ttl,
        purpose: guessSrvPurpose(name),
      };
    }
    case 'CAA': {
      // rest: `0 issue "letsencrypt.org;accounturi=..."` or `0 iodef "mailto:..."`
      const caaMatch = rest.match(/^(\d+)\s+(\S+)\s+"?(.+?)"?\s*$/);
      if (!caaMatch) return null;
      return {
        type: 'CAA',
        name,
        value: caaMatch[3],
        flags: parseInt(caaMatch[1], 10),
        tag: caaMatch[2],
        ttl,
        purpose: guessCaaPurpose(caaMatch[2]),
      };
    }
    default:
      return null;
  }
}

/**
 * Converts an FQDN (from a zone file) to a relative DNS name.
 * e.g. `_imaps._tcp.example.com` with domain `example.com` → `_imaps._tcp`
 *      `example.com` → `@`
 */
function fqdnToRelative(fqdn: string, domainName: string): string {
  const clean = fqdn.replace(/\.$/, '').toLowerCase();
  const domain = domainName.toLowerCase();
  if (clean === domain) return '@';
  if (clean.endsWith('.' + domain)) {
    return clean.slice(0, -(domain.length + 1));
  }
  return clean;
}

/**
 * Extracts the concatenated value from a TXT record's quoted string(s).
 * Handles both single-line `"value"` and multi-line `( "part1" "part2" )`.
 */
function extractTxtValue(raw: string): string | null {
  // Remove surrounding parentheses if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('(')) cleaned = cleaned.slice(1);
  if (cleaned.endsWith(')')) cleaned = cleaned.slice(0, -1);
  cleaned = cleaned.trim();

  // Extract all quoted strings and concatenate
  const parts: string[] = [];
  const re = /"([^"]*)"/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    parts.push(m[1]);
  }
  if (parts.length === 0) return null;
  return parts.join('');
}

function guessTxtPurpose(name: string, value: string): string {
  if (name === '@' && value.startsWith('v=spf1')) return 'Sender Policy Framework (SPF)';
  if (name === '_dmarc') return 'Domain-based Message Authentication Reporting (DMARC)';
  if (name.includes('._domainkey')) {
    if (value.includes('k=ed25519')) return 'DomainKeys Identified Mail (DKIM — ED25519)';
    if (value.includes('k=rsa')) return 'DomainKeys Identified Mail (DKIM — RSA)';
    return 'DomainKeys Identified Mail (DKIM)';
  }
  if (name === '_mta-sts') return 'MTA Strict Transport Security Policy';
  if (name === '_smtp._tls') return 'TLS Error Reporting (TLS-RPT)';
  if (name === '_ua-auto-config') return 'Universal Autoconfiguration (UAAC)';
  if (name === '_validation-persist') return 'Certificate Validation Persistence';
  return 'TXT Record';
}

function guessCnamePurpose(name: string): string {
  if (name === 'autoconfig') return 'Mail Client Autoconfiguration (Thunderbird/Apple)';
  if (name === 'autodiscover') return 'Mail Client Autodiscovery (Outlook)';
  if (name === 'mta-sts') return 'MTA-STS Policy Host';
  if (name === 'ua-auto-config') return 'Universal Autoconfiguration Host';
  return 'CNAME Alias';
}

function guessSrvPurpose(name: string): string {
  if (name.startsWith('_imaps')) return 'IMAP Service Discovery (Port 993)';
  if (name.startsWith('_submissions')) return 'SMTP Submission Service Discovery (Port 465)';
  if (name.startsWith('_pop3s')) return 'POP3 Service Discovery (Port 995)';
  if (name.startsWith('_jmap')) return 'JMAP Service Discovery (Port 443)';
  if (name.startsWith('_caldavs')) return 'CalDAV Service Discovery (Port 443)';
  if (name.startsWith('_carddavs')) return 'CardDAV Service Discovery (Port 443)';
  return 'Service Discovery (SRV)';
}

function guessCaaPurpose(tag: string): string {
  if (tag === 'issue') return 'Certificate Authority Authorization (Issue)';
  if (tag === 'iodef') return 'Certificate Authority Authorization (Incident Report)';
  if (tag === 'issuewild') return 'Certificate Authority Authorization (Wildcard Issue)';
  return 'Certificate Authority Authorization';
}

/**
 * Merges the Toowix canonical records (MX, SPF, DKIM, DMARC with our
 * relaxed policy) with all the additional records parsed from Stalwart's
 * zone file (SRV, CNAME autoconfig/autodiscover, MTA-STS, TLS-RPT, CAA,
 * etc.). The canonical records take precedence over any parsed zone file
 * record at the same (type, name) so our relaxed SPF/DMARC policies are
 * used instead of Stalwart's stricter defaults.
 */
export function buildFullDnsRecords(
  domainName: string,
  dkimKeys: StalwartDkimKey[],
  stalwartZoneFile: string | null | undefined,
): IGeneratedDnsRecord[] {
  // 1. Start with Toowix's canonical records (MX, SPF, DKIM, DMARC)
  const canonical = buildRequiredDnsRecords(domainName, dkimKeys);

  if (!stalwartZoneFile) return canonical;

  // 2. Parse additional records from Stalwart's zone file
  const parsed = parseStalwartZoneFile(stalwartZoneFile, domainName);

  // 3. Build a key set of canonical records so we can deduplicate
  const canonicalKeys = new Set(canonical.map((r) => `${r.type}|${r.name}`.toLowerCase()));

  // 4. Add parsed records that don't collide with canonical ones
  for (const record of parsed) {
    const key = `${record.type}|${record.name}`.toLowerCase();
    // For types like TXT at @ (SPF), TXT at _dmarc (DMARC), and DKIM TXT records,
    // canonical already provides the correct values with our relaxed policy.
    // For DKIM records specifically, check by selector to allow multiple DKIM keys.
    if (canonicalKeys.has(key)) {
      // Exception: DKIM records — canonical covers all selectors returned by
      // dkimKeys, and parseStalwartZoneFile would return the same selectors.
      // Skip the duplicate.
      continue;
    }
    canonical.push(record);
    canonicalKeys.add(key);
  }

  return canonical;
}

/**
 * Renders the canonical record set above as BIND-style zone file text, for
 * the "Manual Setup" copy/export path. Deliberately built from the SAME
 * records buildRequiredDnsRecords() returns (and verifyPublicDns() checks
 * against) rather than from Stalwart's own auto-generated dnsZoneFile —
 * Stalwart's version uses a different, stricter SPF/DMARC policy and can
 * carry a stale/placeholder MX hostname (see docs/STALWART_API_NOTES.md
 * §7C), so a tenant who imported it verbatim could publish records that
 * this same backend would then never verify as active. Keeping one source
 * of truth means the zone file a tenant pastes always matches what's shown
 * in "Required DNS Records" and what verifyPublicDns() is checking for.
 */
export function buildZoneFileText(domainName: string, records: IGeneratedDnsRecord[]): string {
  const lines = [
    `; DNS zone records for ${domainName}`,
    `; Generated by Toowix Mail Platform — matches "Required DNS Records" exactly`,
  ];

  for (const record of records) {
    const fqdn = record.name === '@' ? `${domainName}.` : `${record.name}.${domainName}.`;
    const ttl = record.ttl || 3600;

    if (record.type === 'MX') {
      lines.push(`${fqdn}\t${ttl}\tIN\tMX\t${record.priority} ${record.value}.`);
    } else if (record.type === 'CNAME') {
      lines.push(`${fqdn}\t${ttl}\tIN\tCNAME\t${record.value}.`);
    } else if (record.type === 'SRV') {
      lines.push(`${fqdn}\t${ttl}\tIN\tSRV\t${record.priority ?? 0} ${record.weight ?? 1} ${record.port ?? 0} ${record.value}.`);
    } else if (record.type === 'CAA') {
      lines.push(`${fqdn}\t${ttl}\tIN\tCAA\t${record.flags ?? 0} ${record.tag ?? 'issue'} "${record.value}"`);
    } else {
      lines.push(`${fqdn}\t${ttl}\tIN\tTXT\t"${record.value}"`);
    }
  }

  return lines.join('\n');
}
