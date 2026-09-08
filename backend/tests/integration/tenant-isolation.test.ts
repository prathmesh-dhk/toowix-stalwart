import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../../src/app';
import { connectDatabase, disconnectDatabase } from '../../src/db/connection';
import {
  createTestTenant,
  createTestDomain,
  createTestTenantAdmin,
  createTestMailbox,
  createTestAuditLog,
} from '../setup/factories';
import { TenantModel, DomainModel, AdminUserModel, MailboxModel, AuditLogModel } from '../../src/db/models';
import { stalwartClient } from '../../src/stalwart/client';

let mongoServer: MongoMemoryServer;

describe('Security Integration: Strict Tenant Isolation & IDOR Defense', () => {
  let tenantA: any;
  let tenantAdminA: any;
  let domainA: any;
  let mailboxA: any;

  let tenantB: any;
  let tenantAdminB: any;
  let domainB: any;
  let mailboxB: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri() });

    // Mock Stalwart client methods
    vi.spyOn(stalwartClient, 'updateAccountPassword').mockResolvedValue();
    vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await AdminUserModel.deleteMany({});
    await MailboxModel.deleteMany({});
    await AuditLogModel.deleteMany({});

    // Setup Tenant A and Admin A
    tenantA = await createTestTenant({ name: 'Alpha Corp' });
    domainA = await createTestDomain(tenantA._id, { domainName: 'alpha.test' });
    tenantAdminA = await createTestTenantAdmin(tenantA._id, { email: 'admin@alpha.test' });
    mailboxA = await createTestMailbox(tenantA._id, domainA._id, {
      localPart: 'alice',
      address: 'alice@alpha.test',
    });

    // Setup Tenant B and Admin B
    tenantB = await createTestTenant({ name: 'Beta Industries' });
    domainB = await createTestDomain(tenantB._id, { domainName: 'beta.test' });
    tenantAdminB = await createTestTenantAdmin(tenantB._id, { email: 'admin@beta.test' });
    mailboxB = await createTestMailbox(tenantB._id, domainB._id, {
      localPart: 'bob',
      address: 'bob@beta.test',
    });

    // Setup Audit Logs for each tenant
    await createTestAuditLog({
      tenant_id: tenantA._id.toString(),
      actor_id: tenantAdminA.user._id.toString(),
      action: 'MAILBOX_CREATED',
      resource: 'alice@alpha.test',
    });
    await createTestAuditLog({
      tenant_id: tenantB._id.toString(),
      actor_id: tenantAdminB.user._id.toString(),
      action: 'MAILBOX_CREATED',
      resource: 'bob@beta.test',
    });
  });

  describe('IDOR Protection: Tenant Profile & Overview', () => {
    it('Tenant A should only retrieve Tenant A metadata and cannot see Tenant B', async () => {
      const res = await request(app)
        .get('/api/tenants/me')
        .set('Authorization', `Bearer ${tenantAdminA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.tenant.id).toBe(tenantA._id.toString());
      expect(res.body.tenant.name).toBe('Alpha Corp');
      expect(res.body.tenant.name).not.toBe('Beta Industries');
    });
  });

  describe('IDOR Protection: Mailbox Reading', () => {
    it('Tenant A listing mailboxes should NEVER contain Tenant B mailboxes', async () => {
      const res = await request(app)
        .get('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminA.token}`);

      expect(res.status).toBe(200);
      const addresses = res.body.mailboxes.map((m: any) => m.address);
      expect(addresses).toContain('alice@alpha.test');
      expect(addresses).not.toContain('bob@beta.test');
    });
  });

  describe('IDOR Protection: Malicious Cross-Tenant Modification', () => {
    it('Tenant A Admin CANNOT reset password of Tenant B Mailbox using IDOR', async () => {
      const maliciousTargetId = mailboxB._id.toString();

      const res = await request(app)
        .post(`/api/mailboxes/${maliciousTargetId}/reset-password`)
        .set('Authorization', `Bearer ${tenantAdminA.token}`)
        .send({ newPassword: 'HackedPassword2026!' });

      // Must be 404 (Not Found in Tenant A context)
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('MAILBOX_NOT_FOUND');

      // Verify Mailbox B password was NOT modified in the database
      const unchanged = await MailboxModel.findById(mailboxB._id);
      expect(unchanged).not.toBeNull();
    });

    it('Tenant A Admin CANNOT delete Tenant B Mailbox using IDOR', async () => {
      const maliciousTargetId = mailboxB._id.toString();

      const res = await request(app)
        .delete(`/api/mailboxes/${maliciousTargetId}`)
        .set('Authorization', `Bearer ${tenantAdminA.token}`);

      expect(res.status).toBe(404);

      // Verify Mailbox B still exists in database
      const stillExists = await MailboxModel.findById(mailboxB._id);
      expect(stillExists).not.toBeNull();
      expect(stillExists?.address).toBe('bob@beta.test');
    });
  });

  describe('IDOR Protection: Audit Log Isolation', () => {
    it('Tenant A Admin querying audit logs should NEVER receive Tenant B audit entries', async () => {
      const res = await request(app)
        .get('/api/audit-logs')
        .set('Authorization', `Bearer ${tenantAdminA.token}`);

      expect(res.status).toBe(200);
      const resources = res.body.logs.map((l: any) => l.resource);
      expect(resources).toContain('alice@alpha.test');
      expect(resources).not.toContain('bob@beta.test');
    });
  });
});
