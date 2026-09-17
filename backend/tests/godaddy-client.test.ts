import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoDaddyClient } from '../src/godaddy/client';
import {
  GoDaddyAuthError,
  GoDaddyDomainNotManagedError,
  GoDaddyError,
} from '../src/godaddy/errors';

describe('GoDaddy Client (Offline / Mocked)', () => {
  let client: GoDaddyClient;

  beforeEach(() => {
    client = new GoDaddyClient();
  });

  describe('verifyCredential', () => {
    it('returns domain info when the credential manages the domain', async () => {
      const mockRequest = vi.fn().mockResolvedValue({
        status: 200,
        json: { domain: 'acme.com', domainId: 12345, status: 'ACTIVE' },
      });
      (client as any).request = mockRequest;

      const result = await client.verifyCredential('key', 'secret', 'ACME.com');
      expect(result).toEqual({ domain: 'acme.com', domainId: 12345, status: 'ACTIVE' });
      expect(mockRequest).toHaveBeenCalledWith('GET', '/v1/domains/acme.com', 'key', 'secret');
    });

    it('throws GoDaddyAuthError on 401', async () => {
      (client as any).request = vi.fn().mockResolvedValue({ status: 401, json: { code: 'ACCESS_DENIED' } });
      await expect(client.verifyCredential('bad', 'creds', 'acme.com')).rejects.toThrow(GoDaddyAuthError);
    });

    it('throws GoDaddyDomainNotManagedError on 404', async () => {
      (client as any).request = vi.fn().mockResolvedValue({ status: 404, json: { code: 'UNKNOWN_DOMAIN' } });
      await expect(client.verifyCredential('key', 'secret', 'not-mine.com')).rejects.toThrow(
        GoDaddyDomainNotManagedError
      );
    });

    it('throws a generic GoDaddyError on other 4xx responses', async () => {
      (client as any).request = vi.fn().mockResolvedValue({ status: 422, json: { code: 'INVALID' } });
      await expect(client.verifyCredential('key', 'secret', 'acme.com')).rejects.toThrow(GoDaddyError);
    });
  });

  describe('listDnsRecords', () => {
    it('returns an empty array (no conflict) on 404', async () => {
      (client as any).request = vi.fn().mockResolvedValue({ status: 404, json: null });
      const records = await client.listDnsRecords('key', 'secret', 'acme.com', 'MX', '@');
      expect(records).toEqual([]);
    });

    it('returns existing records when present (conflict signal)', async () => {
      (client as any).request = vi.fn().mockResolvedValue({
        status: 200,
        json: [{ type: 'MX', name: '@', data: 'mail.otherprovider.com', ttl: 3600, priority: 10 }],
      });
      const records = await client.listDnsRecords('key', 'secret', 'acme.com', 'MX', '@');
      expect(records).toHaveLength(1);
      expect(records[0].data).toBe('mail.otherprovider.com');
    });
  });

  describe('createDnsRecords', () => {
    it('sends a PATCH with the given records and resolves on 200', async () => {
      const mockRequest = vi.fn().mockResolvedValue({ status: 200, json: null });
      (client as any).request = mockRequest;

      const records = [{ type: 'TXT' as const, name: '@', data: 'v=spf1 mx ~all', ttl: 3600 }];
      await expect(client.createDnsRecords('key', 'secret', 'acme.com', records)).resolves.not.toThrow();
      expect(mockRequest).toHaveBeenCalledWith('PATCH', '/v1/domains/acme.com/records', 'key', 'secret', records);
    });

    it('correctly maps SRV records with name @ and service/protocol fields', async () => {
      const mockRequest = vi.fn().mockResolvedValue({ status: 200, json: null });
      (client as any).request = mockRequest;

      const records = [
        {
          type: 'SRV' as const,
          name: '_caldavs._tcp',
          data: 'mail.toowix.com',
          ttl: 3600,
          priority: 0,
          weight: 1,
          port: 443,
        },
      ];
      await expect(client.createDnsRecords('key', 'secret', 'acme.com', records)).resolves.not.toThrow();
      expect(mockRequest).toHaveBeenCalledWith('PATCH', '/v1/domains/acme.com/records', 'key', 'secret', [
        {
          type: 'SRV',
          name: '@',
          data: 'mail.toowix.com',
          ttl: 3600,
          priority: 0,
          weight: 1,
          port: 443,
          service: '_caldavs',
          protocol: '_tcp',
        },
      ]);
    });

    it('throws GoDaddyAuthError on 403', async () => {
      (client as any).request = vi.fn().mockResolvedValue({ status: 403, json: { code: 'FORBIDDEN' } });
      await expect(
        client.createDnsRecords('key', 'secret', 'acme.com', [{ type: 'TXT', name: '@', data: 'v=spf1 mx ~all' }])
      ).rejects.toThrow(GoDaddyAuthError);
    });
  });

  describe('SRV handling in listDnsRecords & replaceDnsRecordGroup', () => {
    it('listDnsRecords queries /records/SRV/@ and filters by service and protocol', async () => {
      const mockRequest = vi.fn().mockResolvedValue({
        status: 200,
        json: [
          { type: 'SRV', name: '@', service: '_caldavs', protocol: '_tcp', data: 'mail.toowix.com', port: 443 },
          { type: 'SRV', name: '@', service: '_imaps', protocol: '_tcp', data: 'mail.toowix.com', port: 993 },
        ],
      });
      (client as any).request = mockRequest;

      const records = await client.listDnsRecords('key', 'secret', 'acme.com', 'SRV', '_imaps._tcp');
      expect(records).toHaveLength(1);
      expect(records[0].service).toBe('_imaps');
      expect(records[0].port).toBe(993);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/v1/domains/acme.com/records/SRV/%40', 'key', 'secret');
    });

    it('replaceDnsRecordGroup preserves other SRV services when replacing one SRV group', async () => {
      const existing = [
        { type: 'SRV', name: '@', service: '_caldavs', protocol: '_tcp', data: 'mail.toowix.com', port: 443, priority: 0, weight: 1, ttl: 3600 },
        { type: 'SRV', name: '@', service: '_imaps', protocol: '_tcp', data: 'old.mail.com', port: 993, priority: 0, weight: 1, ttl: 3600 },
      ];
      const mockRequest = vi.fn().mockImplementation(async (method: string, path: string) => {
        if (method === 'GET' && path === '/v1/domains/acme.com/records/SRV') {
          return { status: 200, json: existing };
        }
        if (method === 'PUT' && path === '/v1/domains/acme.com/records/SRV') {
          return { status: 200, json: null };
        }
        return { status: 404, json: null };
      });
      (client as any).request = mockRequest;

      await client.replaceDnsRecordGroup('key', 'secret', 'acme.com', 'SRV', '_imaps._tcp', [
        { data: 'mail.toowix.com', port: 993, priority: 0, weight: 1, ttl: 3600 },
      ]);

      expect(mockRequest).toHaveBeenCalledWith(
        'PUT',
        '/v1/domains/acme.com/records/SRV',
        'key',
        'secret',
        [
          existing[0], // preserved _caldavs
          {
            type: 'SRV',
            name: '@',
            data: 'mail.toowix.com',
            ttl: 3600,
            priority: 0,
            weight: 1,
            port: 993,
            service: '_imaps',
            protocol: '_tcp',
          },
        ]
      );
    });
  });
});
