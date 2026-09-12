import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import {
  AdminUserModel,
  TenantModel,
  DomainModel,
  MailboxModel,
  AuditLogModel,
} from '../src/db/models';
import { generateOidcToken } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';
import { StalwartUnavailableError } from '../src/stalwart/errors';

let mongoServer: MongoMemoryServer;

describe('Phase 5: Tenant Admin Portal, Mailbox CRUD & Atomic Quota Engine', () => {
  let superAdminToken: string;
  let superAdminId: string;

  let tenantAId: string;
  let domainAId: string;
  let tenantAdminAToken: string;
  let tenantAdminAId: string;

  let tenantBId: string;
  let domainBId: string;
  let tenantAdminBToken: string;
  let tenantAdminBId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri() });

    // Mock Stalwart methods by default so tests run fast and isolated
    vi.spyOn(stalwartClient, 'createAccount').mockImplementation(async (input) => ({
      id: 'mock-acc-' + Math.random().toString(36).substring(7),
      name: input.name,
      domainId: input.domainId,
      emailAddress: `${input.name}@mock.test`,
    }));

    vi.spyOn(stalwartClient, 'updateAccountPassword').mockResolvedValue();
    vi.spyOn(stalwartClient, 'updateAccountStatus').mockResolvedValue();
    vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();

    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([
      {
        id: 'dom-wayne',
        name: 'waynecorp.test',
        description: 'Wayne Corp',
        isEnabled: true,
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'dom-stark',
        name: 'starkcorp.test',
        description: 'Stark Corp',
        isEnabled: true,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await AdminUserModel.deleteMany({});
    await MailboxModel.deleteMany({});
    await AuditLogModel.deleteMany({});

    // 1. Super Admin
    const superAdmin = await AdminUserModel.create({
      email: 'super@toowix.test',
      passwordHash: 'argon2id$mocked',
      role: 'SUPER_ADMIN',
      status: 'active',
      twoFactorEnabled: true,
    });
    superAdminId = superAdmin._id.toString();
    superAdminToken = generateOidcToken({
      id: superAdminId,
      email: superAdmin.email,
      role: 'SUPER_ADMIN',
      tenantId: null,
      twoFactorEnabled: true,
    });

    // 2. Tenant A (Wayne Enterprises) - Mailbox Limit: 3
    const tenantA = await TenantModel.create({
      name: 'Wayne Enterprises',
      status: 'active',
      mailboxLimit: 3,
      mailboxCount: 0,
    });
    tenantAId = tenantA._id.toString();

    const domainA = await DomainModel.create({
      tenantId: tenantA._id,
      domainName: 'waynecorp.test',
      stalwartDomainId: 'dom-wayne',
      status: 'active',
    });
    domainAId = domainA._id.toString();

    const tenantAdminA = await AdminUserModel.create({
      email: 'bruce@waynecorp.test',
      passwordHash: 'argon2id$mocked',
      role: 'TENANT_ADMIN',
      tenantId: tenantA._id,
      status: 'active',
      twoFactorEnabled: true,
    });
    tenantAdminAId = tenantAdminA._id.toString();
    tenantAdminAToken = generateOidcToken({
      id: tenantAdminAId,
      email: tenantAdminA.email,
      role: 'TENANT_ADMIN',
      tenantId: tenantAId,
      twoFactorEnabled: true,
    });

    // 3. Tenant B (Stark Industries) - Mailbox Limit: 5
    const tenantB = await TenantModel.create({
      name: 'Stark Industries',
      status: 'active',
      mailboxLimit: 5,
      mailboxCount: 0,
    });
    tenantBId = tenantB._id.toString();

    const domainB = await DomainModel.create({
      tenantId: tenantB._id,
      domainName: 'starkcorp.test',
      stalwartDomainId: 'dom-stark',
      status: 'active',
    });
    domainBId = domainB._id.toString();

    const tenantAdminB = await AdminUserModel.create({
      email: 'tony@starkcorp.test',
      passwordHash: 'argon2id$mocked',
      role: 'TENANT_ADMIN',
      tenantId: tenantB._id,
      status: 'active',
      twoFactorEnabled: true,
    });
    tenantAdminBId = tenantAdminB._id.toString();
    tenantAdminBToken = generateOidcToken({
      id: tenantAdminBId,
      email: tenantAdminB.email,
      role: 'TENANT_ADMIN',
      tenantId: tenantBId,
      twoFactorEnabled: true,
    });
  });

  // =========================================================================
  // 1. Tenant Admin Self-Context (/api/tenants/me)
  // =========================================================================
  describe('Tenant Admin Self-Context (GET /api/tenants/me)', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/tenants/me');
      expect(res.status).toBe(401);
    });

    it('should reject Super Admin requests with 403 (no tenant context)', async () => {
      const res = await request(app)
        .get('/api/tenants/me')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(403);
    });

    it('should return tenant context, 1:1 domain info, and quota stats for Tenant Admin A', async () => {
      const res = await request(app)
        .get('/api/tenants/me')
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.tenant).toBeDefined();
      expect(res.body.tenant.id).toBe(tenantAId);
      expect(res.body.tenant.name).toBe('Wayne Enterprises');
      expect(res.body.tenant.status).toBe('active');
      expect(res.body.tenant.mailboxLimit).toBe(3);
      expect(res.body.tenant.mailboxCount).toBe(0);
      expect(res.body.tenant.availableMailboxes).toBe(3);
      expect(res.body.tenant.adminCount).toBe(1);
      expect(res.body.tenant.domain.domainName).toBe('waynecorp.test');
      expect(res.body.tenant.domain.status).toBe('active');
    });
  });

  // =========================================================================
  // 2. Mailbox Creation & Validation (POST /api/tenants/me/mailboxes)
  // =========================================================================
  describe('Mailbox Creation & Validation', () => {
    it('should reject creation with invalid local part characters', async () => {
      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'bad user name!',
          password: 'Password2026!Secure',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('should reject creation with short password (< 8 chars)', async () => {
      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'alfred',
          password: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('should successfully create mailbox, increment mailboxCount, and emit audit log', async () => {
      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'alfred',
          password: 'AlfredSecretPass2026!',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.localPart).toBe('alfred');
      expect(res.body.address).toBe('alfred@waynecorp.test');
      expect(res.body.status).toBe('active');
      expect(res.body.stalwartAccountId).toBeDefined();

      // Verify MongoDB state
      const tenant = await TenantModel.findById(tenantAId);
      expect(tenant?.mailboxCount).toBe(1);

      const mailboxDoc = await MailboxModel.findOne({ address: 'alfred@waynecorp.test' });
      expect(mailboxDoc).not.toBeNull();
      expect(mailboxDoc?.tenantId.toString()).toBe(tenantAId);

      // Verify Audit Log
      const audit = await AuditLogModel.findOne({ action: 'MAILBOX_CREATED' });
      expect(audit).not.toBeNull();
      expect(audit?.actorRole).toBe('TENANT_ADMIN');
      expect(audit?.tenantId?.toString()).toBe(tenantAId);
      expect(audit?.metadata?.address).toBe('alfred@waynecorp.test');
    });

    it('should reject duplicate mailbox address with 409 and maintain quota', async () => {
      // 1. Create first
      await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'alfred',
          password: 'AlfredSecretPass2026!',
        });

      // 2. Attempt duplicate
      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'alfred',
          password: 'AlfredSecretPass2026!',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('MAILBOX_EXISTS');

      // Mailbox count must remain 1
      const tenant = await TenantModel.findById(tenantAId);
      expect(tenant?.mailboxCount).toBe(1);
    });

    it('should block mailbox creation if tenant is suspended with 403', async () => {
      await TenantModel.updateOne({ _id: tenantAId }, { status: 'suspended' });

      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'selina',
          password: 'CatWoman2026!Secure',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('TENANT_SUSPENDED');

      const tenant = await TenantModel.findById(tenantAId);
      expect(tenant?.mailboxCount).toBe(0);
    });

    it('should rollback quota if Stalwart fails during account creation', async () => {
      vi.spyOn(stalwartClient, 'createAccount').mockRejectedValueOnce(
        new StalwartUnavailableError('Stalwart server connection reset')
      );

      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          localPart: 'lucius',
          password: 'FoxPassword2026!Secure',
        });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('STALWART_UNAVAILABLE');

      // Check quota rolled back
      const tenant = await TenantModel.findById(tenantAId);
      expect(tenant?.mailboxCount).toBe(0);

      // Check no orphaned mailbox in MongoDB
      const mailbox = await MailboxModel.findOne({ address: 'lucius@waynecorp.test' });
      expect(mailbox).toBeNull();

      // Check audit failure log
      const audit = await AuditLogModel.findOne({ action: 'MAILBOX_PROVISION_FAILED' });
      expect(audit).not.toBeNull();
      expect(audit?.status).toBe('FAILED');
    });
  });

  // =========================================================================
  // 3. Atomic Quota Engine & Concurrency Serialization
  // =========================================================================
  describe('Atomic Quota Engine Concurrency', () => {
    it('should serialize concurrent creations and strictly reject requests exceeding quota limit', async () => {
      // Tenant A has mailboxLimit = 3.
      // Pre-create 2 mailboxes so only 1 quota slot remains.
      await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ localPart: 'm1', password: 'Password2026!Secure' });

      await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ localPart: 'm2', password: 'Password2026!Secure' });

      const tenantBefore = await TenantModel.findById(tenantAId);
      expect(tenantBefore?.mailboxCount).toBe(2);

      // Send 5 concurrent requests simultaneously for the single remaining quota slot
      const concurrentRequests = ['r1', 'r2', 'r3', 'r4', 'r5'].map((name) =>
        request(app)
          .post('/api/tenants/me/mailboxes')
          .set('Authorization', `Bearer ${tenantAdminAToken}`)
          .send({ localPart: name, password: 'Password2026!Secure' })
      );

      const responses = await Promise.all(concurrentRequests);

      const successResponses = responses.filter((r) => r.status === 201);
      const quotaExceededResponses = responses.filter((r) => r.status === 409);

      // Exactly 1 must have succeeded, filling the last slot
      expect(successResponses.length).toBe(1);
      // The other 4 must have been rejected with QUOTA_EXCEEDED
      expect(quotaExceededResponses.length).toBe(4);
      quotaExceededResponses.forEach((r) => {
        expect(r.body.error).toBe('QUOTA_EXCEEDED');
      });

      // Verify MongoDB invariant: exactly 3 mailboxes exist
      const tenantAfter = await TenantModel.findById(tenantAId);
      expect(tenantAfter?.mailboxCount).toBe(3);

      const totalDocs = await MailboxModel.countDocuments({ tenantId: tenantAId });
      expect(totalDocs).toBe(3);
    });
  });

  // =========================================================================
  // 4. Mailbox Listing & Inspection
  // =========================================================================
  describe('Mailbox Listing & Inspection', () => {
    beforeEach(async () => {
      // Create 2 mailboxes in Tenant A
      await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ localPart: 'alfred', password: 'Password2026!Secure' });

      await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ localPart: 'bruce-sec', password: 'Password2026!Secure' });

      // Create 1 mailbox in Tenant B
      await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminBToken}`)
        .send({ localPart: 'jarvis', password: 'Password2026!Secure' });
    });

    it('should list only mailboxes belonging to caller tenant', async () => {
      // Tenant A
      const resA = await request(app)
        .get('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(resA.status).toBe(200);
      expect(resA.body.mailboxes.length).toBe(2);
      expect(resA.body.mailboxes.map((m: any) => m.localPart).sort()).toEqual(['alfred', 'bruce-sec']);

      // Tenant B
      const resB = await request(app)
        .get('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminBToken}`);

      expect(resB.status).toBe(200);
      expect(resB.body.mailboxes.length).toBe(1);
      expect(resB.body.mailboxes[0].localPart).toBe('jarvis');
      expect(resB.body.mailboxes[0].address).toBe('jarvis@starkcorp.test');
    });

    it('should retrieve single mailbox detail via GET /api/mailboxes/:id', async () => {
      const listRes = await request(app)
        .get('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`);
      const mailboxId = listRes.body.mailboxes[0].id;

      const res = await request(app)
        .get(`/api/mailboxes/${mailboxId}`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(mailboxId);
      expect(res.body.tenantId).toBe(tenantAId);
    });
  });

  // =========================================================================
  // 5. Mailbox Password Reset (POST /api/mailboxes/:id/reset-password)
  // =========================================================================
  describe('Mailbox Password Reset', () => {
    let mailboxId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ localPart: 'alfred', password: 'OldPassword2026!' });
      mailboxId = res.body.id;
    });

    it('should reject password reset if new password is too short (< 8 chars)', async () => {
      const res = await request(app)
        .post(`/api/mailboxes/${mailboxId}/reset-password`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ newPassword: 'tiny' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('should successfully update password on Stalwart and log audit without persisting password', async () => {
      const updateSpy = vi.spyOn(stalwartClient, 'updateAccountPassword');

      const res = await request(app)
        .post(`/api/mailboxes/${mailboxId}/reset-password`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ newPassword: 'BrandNewSecurePass2026!' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('successfully reset');
      expect(updateSpy).toHaveBeenCalledWith(expect.any(String), 'BrandNewSecurePass2026!');

      // Verify Audit Log
      const audit = await AuditLogModel.findOne({ action: 'MAILBOX_PASSWORD_RESET' });
      expect(audit).not.toBeNull();
      expect(audit?.resourceId).toBe(mailboxId);

      // Verify no password saved in MongoDB
      const doc = await MailboxModel.findById(mailboxId).lean();
      expect((doc as any).password).toBeUndefined();
      expect((doc as any).passwordHash).toBeUndefined();
    });
  });

  // =========================================================================
  // 6. Mailbox Deletion (DELETE /api/mailboxes/:id)
  // =========================================================================
  describe('Mailbox Deletion', () => {
    let mailboxId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ localPart: 'robin', password: 'RobinPassword2026!' });
      mailboxId = res.body.id;
    });

    it('should delete account from Stalwart, delete from MongoDB, and decrement quota', async () => {
      const deleteSpy = vi.spyOn(stalwartClient, 'deleteAccount');

      const res = await request(app)
        .delete(`/api/mailboxes/${mailboxId}`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('successfully deleted');
      expect(deleteSpy).toHaveBeenCalled();

      // Verify deleted from MongoDB
      const doc = await MailboxModel.findById(mailboxId);
      expect(doc).toBeNull();

      // Verify quota count decremented
      const tenant = await TenantModel.findById(tenantAId);
      expect(tenant?.mailboxCount).toBe(0);

      // Verify Audit Log
      const audit = await AuditLogModel.findOne({ action: 'MAILBOX_DELETED' });
      expect(audit).not.toBeNull();
      expect(audit?.resourceId).toBe(mailboxId);
    });
  });

  // =========================================================================
  // 7. Cross-Tenant IDOR Protection (Defense-in-Depth)
  // =========================================================================
  describe('Cross-Tenant IDOR Protection', () => {
    let tenantBMailboxId: string;

    beforeEach(async () => {
      // Create a mailbox under Tenant B (Stark Industries)
      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminBToken}`)
        .send({ localPart: 'jarvis', password: 'JarvisPassword2026!' });
      tenantBMailboxId = res.body.id;
    });

    it('should return 404 when Tenant Admin A attempts to read Tenant B mailbox', async () => {
      const res = await request(app)
        .get(`/api/mailboxes/${tenantBMailboxId}`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('MAILBOX_NOT_FOUND');
    });

    it('should return 404 when Tenant Admin A attempts to reset Tenant B mailbox password', async () => {
      const res = await request(app)
        .post(`/api/mailboxes/${tenantBMailboxId}/reset-password`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ newPassword: 'MaliciousResetPass123!' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('MAILBOX_NOT_FOUND');
    });

    it('should return 404 when Tenant Admin A attempts to delete Tenant B mailbox', async () => {
      const res = await request(app)
        .delete(`/api/mailboxes/${tenantBMailboxId}`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('MAILBOX_NOT_FOUND');

      // Tenant B's mailbox still exists untouched
      const doc = await MailboxModel.findById(tenantBMailboxId);
      expect(doc).not.toBeNull();
      expect(doc?.address).toBe('jarvis@starkcorp.test');

      const tenantB = await TenantModel.findById(tenantBId);
      expect(tenantB?.mailboxCount).toBe(1);
    });
  });

  // =========================================================================
  // 7b. Mailbox Suspension & Reactivation (POST /api/mailboxes/:id/suspend, reactivate)
  // =========================================================================
  describe('Mailbox Suspension & Reactivation', () => {
    let mailboxId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ localPart: 'bruce', password: 'Password2026!Secure' });
      mailboxId = res.body.id;
    });

    it('should suspend an active mailbox and update Stalwart account status', async () => {
      const updateStatusSpy = vi.spyOn(stalwartClient, 'updateAccountStatus');

      const res = await request(app)
        .post(`/api/mailboxes/${mailboxId}/suspend`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.mailbox.status).toBe('suspended');
      expect(updateStatusSpy).toHaveBeenCalledWith(expect.any(String), true);

      // Verify DB status
      const doc = await MailboxModel.findById(mailboxId);
      expect(doc?.status).toBe('suspended');

      // Verify audit log
      const audit = await AuditLogModel.findOne({ action: 'MAILBOX_SUSPENDED' });
      expect(audit).not.toBeNull();
      expect(audit?.tenantId.toString()).toBe(tenantAId);
    });

    it('should reactivate a suspended mailbox and restore Stalwart permissions', async () => {
      // First suspend
      await request(app)
        .post(`/api/mailboxes/${mailboxId}/suspend`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      const updateStatusSpy = vi.spyOn(stalwartClient, 'updateAccountStatus');

      // Then reactivate
      const res = await request(app)
        .post(`/api/mailboxes/${mailboxId}/reactivate`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.mailbox.status).toBe('active');
      expect(updateStatusSpy).toHaveBeenCalledWith(expect.any(String), false);

      const doc = await MailboxModel.findById(mailboxId);
      expect(doc?.status).toBe('active');

      const audit = await AuditLogModel.findOne({ action: 'MAILBOX_REACTIVATED' });
      expect(audit).not.toBeNull();
    });

    it('should reject suspension attempt by another tenant admin', async () => {
      const res = await request(app)
        .post(`/api/mailboxes/${mailboxId}/suspend`)
        .set('Authorization', `Bearer ${tenantAdminBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('MAILBOX_NOT_FOUND');
    });

    it('should block suspension if tenant is suspended', async () => {
      await TenantModel.findByIdAndUpdate(tenantAId, { status: 'suspended' });

      const res = await request(app)
        .post(`/api/mailboxes/${mailboxId}/suspend`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('TENANT_SUSPENDED');
    });
  });

  // =========================================================================
  // 8. Role-Scoped Audit Logs (GET /api/audit-logs)
  // =========================================================================
  describe('Role-Scoped Audit Logs', () => {
    beforeEach(async () => {
      // Action in Tenant A
      await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ localPart: 'alfred', password: 'Password2026!Secure' });

      // Action in Tenant B
      await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminBToken}`)
        .send({ localPart: 'jarvis', password: 'Password2026!Secure' });
    });

    it('should scope audit logs strictly to tenantId for Tenant Admin A', async () => {
      const res = await request(app)
        .get('/api/audit-logs')
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBeGreaterThan(0);
      res.body.logs.forEach((log: any) => {
        expect(log.tenant_id).toBe(tenantAId);
      });
    });

    it('should allow Super Admin to view all audit logs across all tenants', async () => {
      const res = await request(app)
        .get('/api/audit-logs')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const tenantIds = res.body.logs.map((l: any) => l.tenant_id);
      expect(tenantIds).toContain(tenantAId);
      expect(tenantIds).toContain(tenantBId);
    });

    it('should allow Super Admin to filter audit logs by tenantId', async () => {
      const res = await request(app)
        .get(`/api/audit-logs?tenantId=${tenantBId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      res.body.logs.forEach((log: any) => {
        expect(log.tenant_id).toBe(tenantBId);
      });
    });
  });
});
