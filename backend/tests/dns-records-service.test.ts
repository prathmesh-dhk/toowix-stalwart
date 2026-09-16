import { describe, it, expect } from 'vitest';
import { buildRequiredDnsRecords } from '../src/services/dns-records.service';
import { StalwartDkimKey } from '../src/stalwart/types';

describe('dns-records.service — buildRequiredDnsRecords', () => {
  const dkimKeys: StalwartDkimKey[] = [
    {
      id: 'k1',
      domainId: 'd1',
      selector: 'v1-rsa-20260907',
      algorithm: 'Dkim1RsaSha256',
      publicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...RSA_KEY',
      stage: 'active',
    },
    {
      id: 'k2',
      domainId: 'd1',
      selector: 'v1-ed25519-20260907',
      algorithm: 'Dkim1Ed25519Sha256',
      publicKey: 'QOkG7d2Mp2na4pSAAibTnIr4L7o1xLAQyVcwxC8OKMo=',
      stage: 'active',
    },
  ];

  it('includes MX, SPF, one TXT per DKIM key, and DMARC', () => {
    const records = buildRequiredDnsRecords('acme.com', dkimKeys);

    const mx = records.find((r) => r.type === 'MX');
    expect(mx).toMatchObject({ name: '@', value: 'mail.toowix.com', priority: 10 });

    const spf = records.find((r) => r.type === 'TXT' && r.name === '@');
    expect(spf?.value).toContain('v=spf1 mx');
    expect(spf?.value).toContain('ip4:103.13.114.138');
    expect(spf?.value).toContain('~all');

    const rsaDkim = records.find((r) => r.name === 'v1-rsa-20260907._domainkey');
    expect(rsaDkim?.value).toBe('v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...RSA_KEY');

    const ed25519Dkim = records.find((r) => r.name === 'v1-ed25519-20260907._domainkey');
    expect(ed25519Dkim?.value).toBe('v=DKIM1; k=ed25519; p=QOkG7d2Mp2na4pSAAibTnIr4L7o1xLAQyVcwxC8OKMo=');

    const dmarc = records.find((r) => r.name === '_dmarc');
    expect(dmarc?.value).toBe('v=DMARC1; p=none; rua=mailto:dmarc-reports@acme.com');

    expect(records).toHaveLength(5);
  });

  it('produces no DKIM TXT records when no active keys are supplied', () => {
    const records = buildRequiredDnsRecords('acme.com', []);
    expect(records.filter((r) => r.purpose.includes('DKIM'))).toHaveLength(0);
    expect(records).toHaveLength(3); // MX + SPF + DMARC only
  });
});
