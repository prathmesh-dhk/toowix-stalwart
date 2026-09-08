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
  ActivationTokenModel,
  AuditLogModel,
} from '../src/db/models';
import { generateOidcToken, verifyPassword } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';

let mongoServer: MongoMemoryServer;

describe('Phase 6: Platform Administration, Cascade Tenant Deletion & Live Drift Reconciliation', () => {
  let superAdminToken: string;
  let superAdminId: string;

  let tenantAId: string;
  let domainAId: string;
  let tenantAdminAToken: string;
  let tenantAdminAId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri() });

    // Mock Stalwart methods
    vi.spyOn(stalwartClient, 'createAccount').mockImplementation(async (input) => ({
      id: 'mock-acc-' + Math.random().toString(36).substring(7),
      name: input.name,
      emailAddress: `${input.name}@mock.test`,
    }));

    vi.spyOn(stalwartClient, 'updateAccountPassword').mockResolvedValue();
    vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();
    vi.spyOn(stalwartClient, 'deleteDomain').mockResolvedValue();

    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([
      {
        id: 'dom-wayne',
        name: 'waynecorp.test',
        description: 'Wayne Corp',
        isEnabled: true,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]);

    vi.spyOn(stalwartClient, 'listAccounts').mockResolvedValue([
      {
        id: 'acc-service',
        name: 'toowix-service',
        emailAddress: 'toowix-service@toowix.test',
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
    await ActivationTokenModel.deleteMany({});
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

    // 2. Tenant A (Wayne Enterprises)
    const tenantA = await TenantModel.create({
      name: 'Wayne Enterprises',
      status: 'active',
      mailboxLimit: 5,
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
  });

  // =========================================================================
  // 1. Super Admin Tenant Admin Management (/api/platform/tenants/:id/admins)
  // =========================================================================
  describe('Super Admin Tenant Admin Management', () => {
    it('should list all tenant admins for a specific tenant', async () => {
      const res = await request(app)
        .get(`/api/platform/tenants/${tenantAId}/admins`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.admins).toBeDefined();
      expect(res.body.admins.length).toBe(1);
      expect(res.body.admins[0].email).toBe('bruce@waynecorp.test');
      expect(res.body.admins[0].role).toBe('TENANT_ADMIN');
    });

    it('should allow Super Admin to create a new Tenant Admin directly', async () => {
      const res = await request(app)
        .post(`/api/platform/tenants/${tenantAId}/admins`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          email: 'lucius@waynecorp.test',
          password: 'FoxPassword2026!Secure',
        });

      expect(res.status).toBe(201);
      expect(res.body.admin).toBeDefined();
      expect(res.body.admin.email).toBe('lucius@waynecorp.test');
      expect(res.body.admin.role).toBe('TENANT_ADMIN');

      // Verify DB and password hash
      const adminInDb = await AdminUserModel.findOne({ email: 'lucius@waynecorp.test' });
      expect(adminInDb).not.toBeNull();
      const valid = await verifyPassword(adminInDb!.passwordHash, 'FoxPassword2026!Secure');
      expect(valid).toBe(true);

      // Verify Audit Log
      const audit = await AuditLogModel.findOne({ action: 'TENANT_ADMIN_CREATED' });
      expect(audit).not.toBeNull();
      expect(audit?.metadata?.email).toBe('lucius@waynecorp.test');
    });

    it('should reject duplicate tenant admin email with 409', async () => {
      const res = await request(app)
        .post(`/api/platform/tenants/${tenantAId}/admins`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          email: 'bruce@waynecorp.test',
          password: 'AnotherPassword123!',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('ADMIN_EXISTS');
    });

    it('should allow Super Admin to reset a Tenant Admin password', async () => {
      const res = await request(app)
        .post(`/api/platform/tenants/${tenantAId}/admins/${tenantAdminAId}/reset-password`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          newPassword: 'BrandNewBrucePass2026!',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('successfully reset');

      // Verify password changed
      const updatedAdmin = await AdminUserModel.findById(tenantAdminAId);
      const valid = await verifyPassword(updatedAdmin!.passwordHash, 'BrandNewBrucePass2026!');
      expect(valid).toBe(true);

      // Verify Audit Log
      const audit = await AuditLogModel.findOne({ action: 'TENANT_ADMIN_PASSWORD_RESET' });
      expect(audit).not.toBeNull();
      expect(audit?.resourceId).toBe(tenantAdminAId);
    });

    it('should deny non-super admins with 403 on admin management', async () => {
      const res = await request(app)
        .post(`/api/platform/tenants/${tenantAId}/admins`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({
          email: 'hacker@waynecorp.test',
          password: 'Password12345!',
        });

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // 2. Super Admin Tenant Lifecycle & Quotas
  // =========================================================================
  describe('Super Admin Tenant Lifecycle & Quotas', () => {
    it('should suspend a tenant and mark its domain as suspended', async () => {
      const res = await request(app)
        .post(`/api/platform/tenants/${tenantAId}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.tenant.status).toBe('suspended');

      const domain = await DomainModel.findOne({ tenantId: tenantAId });
      expect(domain?.status).toBe('suspended');

      const audit = await AuditLogModel.findOne({ action: 'TENANT_SUSPENDED' });
      expect(audit).not.toBeNull();
    });

    it('should reactivate a suspended tenant and mark its domain active', async () => {
      // First suspend
      await TenantModel.updateOne({ _id: tenantAId }, { status: 'suspended' });
      await DomainModel.updateOne({ tenantId: tenantAId }, { status: 'suspended' });

      const res = await request(app)
        .post(`/api/platform/tenants/${tenantAId}/reactivate`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.tenant.status).toBe('active');

      const domain = await DomainModel.findOne({ tenantId: tenantAId });
      expect(domain?.status).toBe('active');

      const audit = await AuditLogModel.findOne({ action: 'TENANT_REACTIVATED' });
      expect(audit).not.toBeNull();
    });

    it('should update mailbox quota limit', async () => {
      const res = await request(app)
        .patch(`/api/platform/tenants/${tenantAId}/mailbox-limit`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ mailboxLimit: 25 });

      expect(res.status).toBe(200);
      expect(res.body.tenant.mailboxLimit).toBe(25);

      const tenant = await TenantModel.findById(tenantAId);
      expect(tenant?.mailboxLimit).toBe(25);
    });

    it('should reject lowering mailbox quota limit below current usage', async () => {
      // Set usage to 4
      await TenantModel.updateOne({ _id: tenantAId }, { mailboxCount: 4 });

      const res = await request(app)
        .patch(`/api/platform/tenants/${tenantAId}/mailbox-limit`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ mailboxLimit: 3 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('QUOTA_BELOW_USAGE');
    });
  });

  // =========================================================================
  // 3. Cascade Tenant Deletion (DELETE /api/platform/tenants/:id)
  // =========================================================================
  describe('Cascade Tenant Deletion', () => {
    let tenantCId: string;

    beforeEach(async () => {
      // Create Tenant C (Oscorp) with domain, tenant admin, mailboxes, and activation token
      const tenantC = await TenantModel.create({
        name: 'Oscorp Industries',
        status: 'active',
        mailboxLimit: 10,
        mailboxCount: 2,
      });
      tenantCId = tenantC._id.toString();

      await DomainModel.create({
        tenantId: tenantC._id,
        domainName: 'oscorp.test',
        stalwartDomainId: 'dom-oscorp',
        status: 'active',
      });

      await AdminUserModel.create({
        email: 'norman@oscorp.test',
        passwordHash: 'argon2id$mocked',
        role: 'TENANT_ADMIN',
        tenantId: tenantC._id,
        status: 'active',
      });

      await MailboxModel.create({
        tenantId: tenantC._id,
        domainId: new mongoose.Types.ObjectId(),
        localPart: 'green',
        address: 'green@oscorp.test',
        stalwartAccountId: 'mock-acc-oscorp-1',
        status: 'active',
      });

      await MailboxModel.create({
        tenantId: tenantC._id,
        domainId: new mongoose.Types.ObjectId(),
        localPart: 'goblin',
        address: 'goblin@oscorp.test',
        stalwartAccountId: 'mock-acc-oscorp-2',
        status: 'active',
      });

      await ActivationTokenModel.create({
        tenantId: tenantC._id,
        tokenHash: 'dummyhash',
        contactEmail: 'norman@oscorp.test',
        expiresAt: new Date(Date.now() + 10000),
      });
    });

    it('should delete mailboxes and domain from Stalwart and purge all DB records', async () => {
      const deleteAccSpy = vi.spyOn(stalwartClient, 'deleteAccount');
      const deleteDomSpy = vi.spyOn(stalwartClient, 'deleteDomain');

      const res = await request(app)
        .delete(`/api/platform/tenants/${tenantCId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify Stalwart accounts deleted
      expect(deleteAccSpy).toHaveBeenCalledWith('mock-acc-oscorp-1');
      expect(deleteAccSpy).toHaveBeenCalledWith('mock-acc-oscorp-2');

      // Verify Stalwart domain deleted
      expect(deleteDomSpy).toHaveBeenCalledWith('dom-oscorp');

      // Verify MongoDB purge
      const tenant = await TenantModel.findById(tenantCId);
      expect(tenant).toBeNull();

      const domains = await DomainModel.find({ tenantId: tenantCId });
      expect(domains.length).toBe(0);

      const mailboxes = await MailboxModel.find({ tenantId: tenantCId });
      expect(mailboxes.length).toBe(0);

      const admins = await AdminUserModel.find({ tenantId: tenantCId });
      expect(admins.length).toBe(0);

      const tokens = await ActivationTokenModel.find({ tenantId: tenantCId });
      expect(tokens.length).toBe(0);

      // Verify Audit Log
      const audit = await AuditLogModel.findOne({ action: 'TENANT_DELETED' });
      expect(audit).not.toBeNull();
      expect(audit?.metadata?.tenantName).toBe('Oscorp Industries');
      expect(audit?.metadata?.mailboxesDeleted).toBe(2);
    });
  });

  // =========================================================================
  // 4. Live Drift Reconciliation Engine (/api/system/reconciliation)
  // =========================================================================
  describe('Live Drift Reconciliation Engine', () => {
    it('should deny non-super admins with 403', async () => {
      const res = await request(app)
        .get('/api/system/reconciliation')
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(res.status).toBe(403);
    });

    it('should return live drift report for Super Admin', async () => {
      const res = await request(app)
        .get('/api/system/reconciliation')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.synchronized).toBeDefined();
      expect(res.body.database).toBeDefined();
      expect(res.body.database.tenantsCount).toBe(1);
      expect(res.body.database.domainsCount).toBe(1);
      expect(res.body.stalwart).toBeDefined();
      expect(res.body.drift).toBeDefined();
      expect(Array.isArray(res.body.drift.missingInStalwartDomains)).toBe(true);
      expect(Array.isArray(res.body.drift.orphanedInStalwartDomains)).toBe(true);
      expect(Array.isArray(res.body.drift.missingInStalwartMailboxes)).toBe(true);
      expect(Array.isArray(res.body.drift.orphanedInStalwartAccounts)).toBe(true);
      expect(Array.isArray(res.body.drift.quotaDiscrepancies)).toBe(true);
    });

    it('should detect and repair quota drift on demand via /api/system/reconciliation/sync-quota', async () => {
      // 1. Artificially inject quota drift: Tenant A has 0 mailboxes, set mailboxCount to 42
      await TenantModel.updateOne({ _id: tenantAId }, { mailboxCount: 42 });

      // 2. Check reconciliation: drift should be detected
      const driftRes = await request(app)
        .get('/api/system/reconciliation')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(driftRes.status).toBe(200);
      expect(driftRes.body.synchronized).toBe(false);
      expect(driftRes.body.drift.quotaDiscrepancies.length).toBe(1);
      expect(driftRes.body.drift.quotaDiscrepancies[0].tenantId).toBe(tenantAId);
      expect(driftRes.body.drift.quotaDiscrepancies[0].recordedMailboxCount).toBe(42);
      expect(driftRes.body.drift.quotaDiscrepancies[0].actualActiveMailboxes).toBe(0);

      // 3. Trigger repair
      const repairRes = await request(app)
        .post('/api/system/reconciliation/sync-quota')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(repairRes.status).toBe(200);
      expect(repairRes.body.success).toBe(true);
      expect(repairRes.body.repaired.length).toBe(1);
      expect(repairRes.body.repaired[0].tenantId).toBe(tenantAId);
      expect(repairRes.body.repaired[0].oldCount).toBe(42);
      expect(repairRes.body.repaired[0].newCount).toBe(0);

      // 4. Verify MongoDB state restored
      const tenant = await TenantModel.findById(tenantAId);
      expect(tenant?.mailboxCount).toBe(0);

      // 5. Subsequent drift check is synchronized
      const postDriftRes = await request(app)
        .get('/api/system/reconciliation')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(postDriftRes.body.drift.quotaDiscrepancies.length).toBe(0);
    });
  });
});
