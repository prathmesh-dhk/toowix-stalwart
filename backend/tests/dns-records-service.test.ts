import { describe, it, expect } from 'vitest';
import {
  buildRequiredDnsRecords,
  buildFullDnsRecords,
  parseStalwartZoneFile,
  buildZoneFileText,
} from '../src/services/dns-records.service';
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

describe('dns-records.service — parseStalwartZoneFile', () => {
  const sampleZone = `
; Zone file for dhkinnovation.com
dhkinnovation.com. 3600 IN MX 10 mail.toowix.test.
dhkinnovation.com. 3600 IN TXT "v=spf1 mx -all"
_imaps._tcp.dhkinnovation.com. 3600 IN SRV 0 1 993 mail.toowix.test.
_submissions._tcp.dhkinnovation.com. 3600 IN SRV 0 1 465 mail.toowix.test.
autoconfig.dhkinnovation.com. 3600 IN CNAME mail.toowix.test.
dhkinnovation.com. 3600 IN CAA 0 issue "letsencrypt.org;accounturi=https://acme.org"
`;

  it('parses SRV, CNAME, CAA records and replaces .test hostnames', () => {
    const records = parseStalwartZoneFile(sampleZone, 'dhkinnovation.com');

    const srvImaps = records.find((r) => r.name === '_imaps._tcp');
    expect(srvImaps).toBeDefined();
    expect(srvImaps?.type).toBe('SRV');
    expect(srvImaps?.port).toBe(993);
    expect(srvImaps?.priority).toBe(0);
    expect(srvImaps?.weight).toBe(1);
    expect(srvImaps?.value).toBe('mail.toowix.com');

    const cname = records.find((r) => r.name === 'autoconfig');
    expect(cname).toBeDefined();
    expect(cname?.type).toBe('CNAME');
    expect(cname?.value).toBe('mail.toowix.com');

    const caa = records.find((r) => r.type === 'CAA');
    expect(caa).toBeDefined();
    expect(caa?.name).toBe('@');
    expect(caa?.tag).toBe('issue');
    expect(caa?.flags).toBe(0);
  });
});

describe('dns-records.service — buildFullDnsRecords & buildZoneFileText', () => {
  const sampleZone = `
_imaps._tcp.dhkinnovation.com. 3600 IN SRV 0 1 993 mail.toowix.com.
autoconfig.dhkinnovation.com. 3600 IN CNAME mail.toowix.com.
dhkinnovation.com. 3600 IN CAA 0 issue "letsencrypt.org"
`;

  it('merges canonical records with Stalwart zone records without duplicating MX/SPF', () => {
    const full = buildFullDnsRecords('dhkinnovation.com', [], sampleZone);

    // Canonical SPF should be preserved (~all, not -all)
    const spf = full.find((r) => r.type === 'TXT' && r.name === '@');
    expect(spf?.value).toContain('~all');

    // SRV, CNAME, CAA from zone should be present
    expect(full.some((r) => r.type === 'SRV')).toBe(true);
    expect(full.some((r) => r.type === 'CNAME')).toBe(true);
    expect(full.some((r) => r.type === 'CAA')).toBe(true);
  });

  it('generates standard BIND zone file text matching record set', () => {
    const records = buildRequiredDnsRecords('dhkinnovation.com', []);
    const zoneText = buildZoneFileText('dhkinnovation.com', records);

    expect(zoneText).toContain('dhkinnovation.com.\t3600\tIN\tMX\t10 mail.toowix.com.');
    expect(zoneText).toContain('dhkinnovation.com.\t3600\tIN\tTXT\t"v=spf1 mx');
  });
});
