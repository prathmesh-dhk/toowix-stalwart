import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('dns/promises', () => ({
  resolveNs: vi.fn(),
}));

import { resolveNs } from 'dns/promises';
import { detectDnsProvider } from '../src/dns-providers/detect-provider';

describe('detectDnsProvider', () => {
  beforeEach(() => {
    vi.mocked(resolveNs).mockReset();
  });

  it('detects Cloudflare from *.ns.cloudflare.com nameservers', async () => {
    vi.mocked(resolveNs).mockResolvedValue(['aida.ns.cloudflare.com', 'walt.ns.cloudflare.com']);
    const result = await detectDnsProvider('acme.com');
    expect(result.provider).toBe('cloudflare');
    expect(result.nameservers).toHaveLength(2);
  });

  it('detects GoDaddy from *.domaincontrol.com nameservers', async () => {
    vi.mocked(resolveNs).mockResolvedValue(['ns1.domaincontrol.com', 'ns2.domaincontrol.com']);
    const result = await detectDnsProvider('acme.com');
    expect(result.provider).toBe('godaddy');
  });

  it('detects Hostinger from *.dns-parking.com nameservers', async () => {
    vi.mocked(resolveNs).mockResolvedValue(['ns1.dns-parking.com', 'ns2.dns-parking.com']);
    const result = await detectDnsProvider('acme.com');
    expect(result.provider).toBe('hostinger');
  });

  it('returns null for an unsupported/unrecognized provider', async () => {
    vi.mocked(resolveNs).mockResolvedValue(['ns1.awsdns-01.com', 'ns2.awsdns-02.org']);
    const result = await detectDnsProvider('acme.com');
    expect(result.provider).toBeNull();
    expect(result.nameservers).toHaveLength(2);
  });

  it('returns null without throwing when the domain has no NS records (NXDOMAIN, etc.)', async () => {
    vi.mocked(resolveNs).mockRejectedValue(new Error('ENOTFOUND'));
    const result = await detectDnsProvider('doesnotexist.invalid');
    expect(result.provider).toBeNull();
    expect(result.nameservers).toEqual([]);
  });
});
