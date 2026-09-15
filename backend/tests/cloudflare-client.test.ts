import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudflareClient } from '../src/cloudflare/client';
import {
  CloudflareAuthError,
  CloudflareDomainNotManagedError,
  CloudflareError,
} from '../src/cloudflare/errors';

describe('Cloudflare Client (Offline / Mocked)', () => {
  let client: CloudflareClient;

  beforeEach(() => {
    client = new CloudflareClient();
  });

  describe('verifyCredential', () => {
    it('resolves the zone and returns the domain when the token manages it', async () => {
      const mockRequest = vi.fn().mockResolvedValue({
        status: 200,
        json: { success: true, result: [{ id: 'zone123', name: 'acme.com', status: 'active' }] },
      });
      (client as any).request = mockRequest;

      const result = await client.verifyCredential('token123', 'ACME.com');
      expect(result).toEqual({ domain: 'acme.com' });
      expect(mockRequest).toHaveBeenCalledWith('GET', '/zones?name.exact=acme.com', 'token123');
    });

    it('throws CloudflareAuthError on 401', async () => {
      (client as any).request = vi.fn().mockResolvedValue({ status: 401, json: { success: false, errors: [] } });
      await expect(client.verifyCredential('bad-token', 'acme.com')).rejects.toThrow(CloudflareAuthError);
    });

    it('throws CloudflareDomainNotManagedError when no zone is found', async () => {
      (client as any).request = vi.fn().mockResolvedValue({ status: 200, json: { success: true, result: [] } });
      await expect(client.verifyCredential('token123', 'not-mine.com')).rejects.toThrow(
        CloudflareDomainNotManagedError
      );
    });

    it('throws a generic CloudflareError when success:false with no auth status', async () => {
      (client as any).request = vi.fn().mockResolvedValue({ status: 200, json: { success: false, errors: [{ message: 'bad' }] } });
      await expect(client.verifyCredential('token123', 'acme.com')).rejects.toThrow(CloudflareError);
    });
  });

  describe('listDnsRecords', () => {
    it('resolves the zone then lists records filtered by exact FQDN and type', async () => {
      const mockRequest = vi
        .fn()
        .mockResolvedValueOnce({ status: 200, json: { success: true, result: [{ id: 'zone123', name: 'acme.com', status: 'active' }] } })
        .mockResolvedValueOnce({
          status: 200,
          json: { success: true, result: [{ id: 'rec1', type: 'MX', name: 'acme.com', content: 'mail.otherprovider.com', ttl: 3600, priority: 10 }] },
        });
      (client as any).request = mockRequest;

      const records = await client.listDnsRecords('token123', 'acme.com', 'MX', '@');
      expect(records).toEqual([{ type: 'MX', name: '@', data: 'mail.otherprovider.com', ttl: 3600, priority: 10 }]);
      expect(mockRequest).toHaveBeenNthCalledWith(2, 'GET', '/zones/zone123/dns_records?type=MX&name.exact=acme.com', 'token123');
    });

    it('converts a relative name into an FQDN for the exact-match filter', async () => {
      const mockRequest = vi
        .fn()
        .mockResolvedValueOnce({ status: 200, json: { success: true, result: [{ id: 'zone123', name: 'acme.com', status: 'active' }] } })
        .mockResolvedValueOnce({ status: 200, json: { success: true, result: [] } });
      (client as any).request = mockRequest;

      await client.listDnsRecords('token123', 'acme.com', 'TXT', '_dmarc');
      expect(mockRequest).toHaveBeenNthCalledWith(
        2,
        'GET',
        '/zones/zone123/dns_records?type=TXT&name.exact=_dmarc.acme.com',
        'token123'
      );
    });
  });

  describe('createDnsRecords', () => {
    it('creates one record per call with the full FQDN and MX priority as a top-level field', async () => {
      const mockRequest = vi
        .fn()
        .mockResolvedValueOnce({ status: 200, json: { success: true, result: [{ id: 'zone123', name: 'acme.com', status: 'active' }] } })
        .mockResolvedValueOnce({ status: 200, json: { success: true, result: { id: 'rec1' } } })
        .mockResolvedValueOnce({ status: 200, json: { success: true, result: { id: 'rec2' } } });
      (client as any).request = mockRequest;

      await client.createDnsRecords('token123', 'acme.com', [
        { type: 'MX', name: '@', data: 'mail.toowix.com', priority: 10, ttl: 3600 },
        { type: 'TXT', name: '_dmarc', data: 'v=DMARC1; p=none', ttl: 3600 },
      ]);

      expect(mockRequest).toHaveBeenNthCalledWith(2, 'POST', '/zones/zone123/dns_records', 'token123', {
        type: 'MX',
        name: 'acme.com',
        content: 'mail.toowix.com',
        ttl: 3600,
        priority: 10,
      });
      expect(mockRequest).toHaveBeenNthCalledWith(3, 'POST', '/zones/zone123/dns_records', 'token123', {
        type: 'TXT',
        name: '_dmarc.acme.com',
        content: 'v=DMARC1; p=none',
        ttl: 3600,
      });
    });

    it('throws CloudflareAuthError on 403 during record creation', async () => {
      (client as any).request = vi
        .fn()
        .mockResolvedValueOnce({ status: 200, json: { success: true, result: [{ id: 'zone123', name: 'acme.com', status: 'active' }] } })
        .mockResolvedValueOnce({ status: 403, json: { success: false, errors: [] } });

      await expect(
        client.createDnsRecords('token123', 'acme.com', [{ type: 'TXT', name: '@', data: 'x' }])
      ).rejects.toThrow(CloudflareAuthError);
    });
  });
});
