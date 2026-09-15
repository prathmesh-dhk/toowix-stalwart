import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HostingerClient } from '../src/hostinger/client';
import {
  HostingerAuthError,
  HostingerDomainNotManagedError,
  HostingerError,
} from '../src/hostinger/errors';

describe('Hostinger Client (Offline / Mocked)', () => {
  let client: HostingerClient;

  beforeEach(() => {
    client = new HostingerClient();
  });

  describe('verifyCredential', () => {
    it('returns the domain when the zone is readable', async () => {
      const mockRequest = vi.fn().mockResolvedValue({
        status: 200,
        json: [{ name: '@', type: 'A', ttl: 3600, records: [{ content: '1.2.3.4' }] }],
      });
      (client as any).request = mockRequest;

      const result = await client.verifyCredential('token123', 'ACME.com');
      expect(result).toEqual({ domain: 'acme.com' });
      expect(mockRequest).toHaveBeenCalledWith('GET', '/api/dns/v1/zones/acme.com', 'token123');
    });

    it('throws HostingerAuthError on 401', async () => {
      (client as any).request = vi.fn().mockResolvedValue({ status: 401, json: { message: 'Unauthorized' } });
      await expect(client.verifyCredential('bad-token', 'acme.com')).rejects.toThrow(HostingerAuthError);
    });

    it('throws HostingerDomainNotManagedError on 404', async () => {
      (client as any).request = vi.fn().mockResolvedValue({ status: 404, json: { message: 'Not found' } });
      await expect(client.verifyCredential('token123', 'not-mine.com')).rejects.toThrow(
        HostingerDomainNotManagedError
      );
    });

    it('throws a generic HostingerError on other 4xx responses', async () => {
      (client as any).request = vi.fn().mockResolvedValue({ status: 422, json: { message: 'Invalid' } });
      await expect(client.verifyCredential('token123', 'acme.com')).rejects.toThrow(HostingerError);
    });
  });

  describe('listDnsRecords', () => {
    it('returns an empty array (no conflict) when the name+type group is absent', async () => {
      (client as any).request = vi.fn().mockResolvedValue({
        status: 200,
        json: [{ name: '_dmarc', type: 'TXT', ttl: 3600, records: [{ content: 'v=DMARC1; p=none' }] }],
      });
      const records = await client.listDnsRecords('token123', 'acme.com', 'MX', '@');
      expect(records).toEqual([]);
    });

    it('flattens matching group records (conflict signal)', async () => {
      (client as any).request = vi.fn().mockResolvedValue({
        status: 200,
        json: [{ name: '@', type: 'MX', ttl: 3600, records: [{ content: '10 mail.otherprovider.com' }] }],
      });
      const records = await client.listDnsRecords('token123', 'acme.com', 'MX', '@');
      expect(records).toHaveLength(1);
      expect(records[0].data).toBe('10 mail.otherprovider.com');
    });
  });

  describe('createDnsRecords', () => {
    it('always sends overwrite:false and encodes MX priority into content', async () => {
      const mockRequest = vi.fn().mockResolvedValue({ status: 200, json: null });
      (client as any).request = mockRequest;

      await client.createDnsRecords('token123', 'acme.com', [
        { type: 'MX', name: '@', data: 'mail.toowix.com', priority: 10, ttl: 3600 },
        { type: 'TXT', name: '@', data: 'v=spf1 mx include:_spf.toowix.com ~all', ttl: 3600 },
      ]);

      expect(mockRequest).toHaveBeenCalledWith('PUT', '/api/dns/v1/zones/acme.com', 'token123', {
        overwrite: false,
        zone: [
          { name: '@', type: 'MX', ttl: 3600, records: [{ content: '10 mail.toowix.com' }] },
          { name: '@', type: 'TXT', ttl: 3600, records: [{ content: 'v=spf1 mx include:_spf.toowix.com ~all' }] },
        ],
      });
    });

    it('throws HostingerAuthError on 403', async () => {
      (client as any).request = vi.fn().mockResolvedValue({ status: 403, json: { message: 'Forbidden' } });
      await expect(
        client.createDnsRecords('token123', 'acme.com', [{ type: 'TXT', name: '@', data: 'x' }])
      ).rejects.toThrow(HostingerAuthError);
    });
  });
});
