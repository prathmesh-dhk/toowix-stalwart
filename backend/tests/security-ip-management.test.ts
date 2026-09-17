import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../src/app';
import { AdminUserModel } from '../src/db/models/AdminUser';
import { TenantModel } from '../src/db/models/Tenant';
import { DomainModel } from '../src/db/models/Domain';
import { AuditLogModel } from '../src/db/models/AuditLog';
import { generateOidcToken, hashPassword } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';

describe('Security Firewall & IP Management API (/api/tenants/me/security)', () => {
  let mongod: MongoMemoryServer;
  let tenantId: string;
  let adminId: string;
  let adminToken: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await AdminUserModel.deleteMany({});
    await TenantModel.deleteMany({});
    await AuditLogModel.deleteMany({});
    vi.restoreAllMocks();

    const tenant = await TenantModel.create({
      name: 'Firewall Test Org',
      contactEmail: 'admin@firewalltest.com',
      status: 'active',
      mailboxLimit: 10,
      mailboxCount: 0,
    });
    tenantId = tenant._id.toString();

    const passwordHash = await hashPassword('FirewallPass123!');
    const admin = await AdminUserModel.create({
      email: 'admin@firewalltest.com',
      passwordHash,
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
      status: 'active',
      twoFactorEnabled: false,
    });
    adminId = admin._id.toString();

    adminToken = generateOidcToken({
      id: adminId,
      email: 'admin@firewalltest.com',
      role: 'TENANT_ADMIN',
      tenantId,
      twoFactorEnabled: false,
    });
  });

  describe('GET /api/tenants/me/security/check-ip', () => {
    it('should return isBlocked: true when target IP matches a blocked entry', async () => {
      vi.spyOn(stalwartClient, 'listBlockedIps').mockResolvedValue([
        { id: 'blk-1', address: '203.0.113.50', reason: 'manual', createdAt: '2026-09-15T00:00:00Z' },
      ]);
      vi.spyOn(stalwartClient, 'listAllowedIps').mockResolvedValue([]);

      const res = await request(app)
        .get('/api/tenants/me/security/check-ip?ip=203.0.113.50')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.ip).toBe('203.0.113.50');
      expect(res.body.isBlocked).toBe(true);
      expect(res.body.blockedEntry).toMatchObject({ id: 'blk-1', address: '203.0.113.50' });
      expect(res.body.isAllowed).toBe(false);
    });

    it('should return isAllowed: true when target IP matches an allowed entry', async () => {
      vi.spyOn(stalwartClient, 'listBlockedIps').mockResolvedValue([]);
      vi.spyOn(stalwartClient, 'listAllowedIps').mockResolvedValue([
        { id: 'alw-1', address: '198.51.100.22', reason: 'HQ Office', createdAt: '2026-09-15T00:00:00Z' },
      ]);

      const res = await request(app)
        .get('/api/tenants/me/security/check-ip?ip=198.51.100.22')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.isBlocked).toBe(false);
      expect(res.body.isAllowed).toBe(true);
      expect(res.body.allowedEntry).toMatchObject({ id: 'alw-1', address: '198.51.100.22' });
    });

    it('should reject invalid IP format with 400', async () => {
      const res = await request(app)
        .get('/api/tenants/me/security/check-ip?ip=not-a-valid-ip')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_IP_FORMAT');
    });

    it('should reject missing IP query param with 400', async () => {
      const res = await request(app)
        .get('/api/tenants/me/security/check-ip')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('MISSING_IP');
    });
  });

  describe('GET /api/tenants/me/security/blocked-ips', () => {
    it('should return list of blocked IPs from Stalwart', async () => {
      vi.spyOn(stalwartClient, 'listBlockedIps').mockResolvedValue([
        { id: 'blk-1', address: '203.0.113.10', reason: 'brute-force', createdAt: '2026-09-15T10:00:00Z' },
        { id: 'blk-2', address: '203.0.113.11', reason: 'manual', createdAt: '2026-09-15T11:00:00Z' },
      ]);

      const res = await request(app)
        .get('/api/tenants/me/security/blocked-ips')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.list).toHaveLength(2);
      expect(res.body.list[0].address).toBe('203.0.113.10');
    });
  });

  describe('POST /api/tenants/me/security/blocked-ips/unblock', () => {
    it('should unblock by ID and create an audit log', async () => {
      const unblockSpy = vi.spyOn(stalwartClient, 'unblockIp').mockResolvedValue();

      const res = await request(app)
        .post('/api/tenants/me/security/blocked-ips/unblock')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ id: 'blk-test-123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.unblockedCount).toBe(1);
      expect(unblockSpy).toHaveBeenCalledWith('blk-test-123');

      const audit = await AuditLogModel.findOne({ action: 'SECURITY_IP_UNBLOCKED' });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(adminId);
    });

    it('should unblock by address (lookup matching ID and unblock)', async () => {
      vi.spyOn(stalwartClient, 'listBlockedIps').mockResolvedValue([
        { id: 'blk-match-1', address: '203.0.113.99', reason: 'manual' },
      ]);
      const unblockSpy = vi.spyOn(stalwartClient, 'unblockIp').mockResolvedValue();

      const res = await request(app)
        .post('/api/tenants/me/security/blocked-ips/unblock')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ address: '203.0.113.99' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.unblockedCount).toBe(1);
      expect(unblockSpy).toHaveBeenCalledWith('blk-match-1');
    });

    it('should reject request when neither id nor address is provided', async () => {
      const res = await request(app)
        .post('/api/tenants/me/security/blocked-ips/unblock')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('MISSING_IDENTIFIER');
    });
  });

  describe('POST /api/tenants/me/security/blocked-ips (Manual Block)', () => {
    it('should manually block an IP and log audit event', async () => {
      vi.spyOn(stalwartClient, 'blockIp').mockResolvedValue({
        id: 'new-blk-1',
        address: '198.51.100.88',
        reason: 'manual',
        createdAt: new Date().toISOString(),
      });

      const res = await request(app)
        .post('/api/tenants/me/security/blocked-ips')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ address: '198.51.100.88', reason: 'manual' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.item.id).toBe('new-blk-1');

      const audit = await AuditLogModel.findOne({ action: 'SECURITY_IP_BLOCKED' });
      expect(audit).not.toBeNull();
      expect(audit?.metadata?.address).toBe('198.51.100.88');
    });
  });

  describe('Allowed IPs / Whitelist Endpoints', () => {
    it('should list allowed IPs', async () => {
      vi.spyOn(stalwartClient, 'listAllowedIps').mockResolvedValue([
        { id: 'alw-1', address: '192.168.1.0/24', reason: 'Local LAN', createdAt: '2026-09-15T00:00:00Z' },
      ]);

      const res = await request(app)
        .get('/api/tenants/me/security/allowed-ips')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.list).toHaveLength(1);
      expect(res.body.list[0].address).toBe('192.168.1.0/24');
    });

    it('should add an allowed IP (whitelist) with CIDR and create audit record', async () => {
      vi.spyOn(stalwartClient, 'addAllowedIp').mockResolvedValue({
        id: 'alw-new',
        address: '10.0.0.0/16',
        reason: 'Office VPN Subnet',
        createdAt: new Date().toISOString(),
      });

      const res = await request(app)
        .post('/api/tenants/me/security/allowed-ips')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ address: '10.0.0.0/16', reason: 'Office VPN Subnet' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.item.address).toBe('10.0.0.0/16');

      const audit = await AuditLogModel.findOne({ action: 'SECURITY_IP_WHITELISTED' });
      expect(audit).not.toBeNull();
      expect(audit?.metadata?.address).toBe('10.0.0.0/16');
    });

    it('should reject invalid CIDR notation', async () => {
      const res = await request(app)
        .post('/api/tenants/me/security/allowed-ips')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ address: '999.999.999.999/33', reason: 'Bad IP' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_IP_FORMAT');
    });

    it('should delete an allowed IP by ID and log audit event', async () => {
      const removeSpy = vi.spyOn(stalwartClient, 'removeAllowedIp').mockResolvedValue();

      const res = await request(app)
        .delete('/api/tenants/me/security/allowed-ips/alw-del-123')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(removeSpy).toHaveBeenCalledWith('alw-del-123');

      const audit = await AuditLogModel.findOne({ action: 'SECURITY_IP_WHITELIST_REMOVED' });
      expect(audit).not.toBeNull();
      expect(audit?.resourceId).toBe('alw-del-123');
    });
  });

  describe('Per-Domain IP Scoping (/api/tenants/me/security?domainId=...)', () => {
    let testDomainId: string;

    beforeEach(async () => {
      await DomainModel.deleteMany({});
      const domain = await DomainModel.create({
        tenantId: new mongoose.Types.ObjectId(tenantId),
        domainName: 'testdomain.com',
        status: 'active',
        mailboxLimit: 10,
        employeeCount: 10,
        dnsStatus: 'active',
        blockedIps: [
          {
            id: 'blk-dom-1',
            address: '198.51.100.99',
            reason: 'Domain specific block',
            createdAt: new Date(),
          },
        ],
        allowedIps: [
          {
            id: 'alw-dom-1',
            address: '198.51.100.88',
            reason: 'Domain specific allow',
            createdAt: new Date(),
          },
        ],
      });
      testDomainId = domain._id.toString();
    });

    it('should list blocked IPs scoped to a specific domain', async () => {
      const res = await request(app)
        .get(`/api/tenants/me/security/blocked-ips?domainId=${testDomainId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.list).toHaveLength(1);
      expect(res.body.list[0].address).toBe('198.51.100.99');
    });

    it('should add a blocked IP scoped to a specific domain', async () => {
      vi.spyOn(stalwartClient, 'blockIp').mockResolvedValue({
        id: 'blk-stw-1',
        address: '203.0.113.111',
        reason: 'Malicious domain probe',
      });

      const res = await request(app)
        .post('/api/tenants/me/security/blocked-ips')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          address: '203.0.113.111',
          reason: 'Malicious domain probe',
          domainId: testDomainId,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const domain = await DomainModel.findById(testDomainId);
      expect(domain?.blockedIps).toHaveLength(2);
      expect(domain?.blockedIps?.some((b) => b.address === '203.0.113.111')).toBe(true);
    });

    it('should unblock an IP for a specific domain', async () => {
      vi.spyOn(stalwartClient, 'unblockIp').mockResolvedValue();

      const res = await request(app)
        .post('/api/tenants/me/security/blocked-ips/unblock')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: 'blk-dom-1',
          address: '198.51.100.99',
          domainId: testDomainId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const domain = await DomainModel.findById(testDomainId);
      expect(domain?.blockedIps).toHaveLength(0);
    });

    it('should list allowed IPs scoped to a specific domain', async () => {
      const res = await request(app)
        .get(`/api/tenants/me/security/allowed-ips?domainId=${testDomainId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.list).toHaveLength(1);
      expect(res.body.list[0].address).toBe('198.51.100.88');
    });

    it('should add an allowed IP scoped to a specific domain', async () => {
      vi.spyOn(stalwartClient, 'addAllowedIp').mockResolvedValue({
        id: 'alw-stw-2',
        address: '10.200.0.1',
        reason: 'Branch router',
      });

      const res = await request(app)
        .post('/api/tenants/me/security/allowed-ips')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          address: '10.200.0.1',
          reason: 'Branch router',
          domainId: testDomainId,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const domain = await DomainModel.findById(testDomainId);
      expect(domain?.allowedIps).toHaveLength(2);
      expect(domain?.allowedIps?.some((a) => a.address === '10.200.0.1')).toBe(true);
    });

    it('should remove an allowed IP for a specific domain', async () => {
      vi.spyOn(stalwartClient, 'removeAllowedIp').mockResolvedValue();

      const res = await request(app)
        .delete(`/api/tenants/me/security/allowed-ips/alw-dom-1?domainId=${testDomainId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const domain = await DomainModel.findById(testDomainId);
      expect(domain?.allowedIps).toHaveLength(0);
    });
  });
});
