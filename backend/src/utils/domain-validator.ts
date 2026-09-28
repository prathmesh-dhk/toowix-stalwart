import { parse } from 'tldts';

export const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const SPECIAL_USE_TLDS = new Set([
  'test',
  'example',
  'invalid',
  'localhost',
  'internal',
  'local',
]);

/**
 * Validates that a domain string meets DNS format rules AND has a valid public suffix / TLD
 * recognized by mail servers like Stalwart (or a standard RFC special-use test TLD).
 */
export function isValidMailDomain(domain: string): boolean {
  const clean = domain.trim().toLowerCase();
  if (!clean || clean.length > 253) return false;
  if (!DOMAIN_REGEX.test(clean)) return false;

  const parsed = parse(clean);
  if (parsed.isIcann) return true;

  // Allow standard RFC 2606 / 6761 special-use / private test TLDs
  const suffix = (parsed.publicSuffix || clean.split('.').pop() || '').toLowerCase();
  return SPECIAL_USE_TLDS.has(suffix);
}
