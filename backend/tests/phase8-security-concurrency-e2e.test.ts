import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { generateSecret, generateSync } from 'otplib';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import {
  AdminUserModel,
  TenantModel,
  DomainModel,
  MailboxModel,
  RegistrationApplicationModel,
  ActivationTokenModel,
  BackupRecordModel,
  AuditLogModel,
} from '../src/db/models';
import { generateOidcToken, hashPassword } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';
import { backupService } from '../src/services/backup.service';

let mongoServer: MongoMemoryServer;
let tempBackupsDir: string;

describe('Phase 8: End-to-End Hardening, Concurrency Stress & Security Penetration Testing', () => {
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
  let mailboxBId: string;
  let mockDomains: any[] = [];

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri() });

    tempBackupsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toowix-phase8-backups-'));
    backupService.setBackupsDir(tempBackupsDir);

    // Dynamic Mock Stalwart Primitives
    mockDomains = [
      { id: 'dom-alpha', name: 'alpha.test', isEnabled: true, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'dom-beta', name: 'beta.test', isEnabled: true, createdAt: '2026-01-01T00:00:00Z' },
    ];

    vi.spyOn(stalwartClient, 'createDomain').mockImplementation(async (name, desc) => {
      const newDom = { id: `dom-${name}`, name, description: desc, isEnabled: true, createdAt: new Date().toISOString() };
      mockDomains.push(newDom);
      return { id: newDom.id, name };
    });

    vi.spyOn(stalwartClient, 'deleteDomain').mockImplementation(async (domainId) => {
      const idx = mockDomains.findIndex(d => d.id === domainId || d.name === domainId);
      if (idx !== -1) mockDomains.splice(idx, 1);
    });

    vi.spyOn(stalwartClient, 'updateDomainStatus').mockImplementation(async (domainId, isEnabled) => {
      const dom = mockDomains.find(d => d.id === domainId || d.name === domainId);
      if (dom) dom.isEnabled = isEnabled;
    });

    vi.spyOn(stalwartClient, 'listDomains').mockImplementation(async () => {
      return [...mockDomains];
    });

    vi.spyOn(stalwartClient, 'createAccount').mockImplementation(async (input) => ({
      id: `acc-${input.name}-${Math.random().toString(36).substring(7)}`,
      name: input.name,
      domainId: input.domainId,
      emailAddress: `${input.name}@mock.test`,
    }));

    vi.spyOn(stalwartClient, 'updateAccountPassword').mockResolvedValue();
    vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();

    vi.spyOn(stalwartClient, 'listAccounts').mockResolvedValue([
      { id: 'acc-service', name: 'toowix-service', domainId: 'dom-mock', emailAddress: 'toowix-service@toowix.test' },
    ]);
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
    if (fs.existsSync(tempBackupsDir)) {
      fs.rmSync(tempBackupsDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await AdminUserModel.deleteMany({});
    await MailboxModel.deleteMany({});
    await RegistrationApplicationModel.deleteMany({});
    await ActivationTokenModel.deleteMany({});
    await BackupRecordModel.deleteMany({});
    await AuditLogModel.deleteMany({});

    // 1. Super Admin
    const superAdmin = await AdminUserModel.create({
      email: 'root@toowix.com',
      passwordHash: await hashPassword('SuperSecureAdminPassword2026!'),
      role: 'SUPER_ADMIN',
      status: 'active',
      twoFactorEnabled: true,
      twoFactorSecret: generateSecret(),
    });
    superAdminId = (superAdmin._id as any).toString();
    superAdminToken = generateOidcToken({
      id: superAdminId,
      email: 'root@toowix.com',
      role: 'SUPER_ADMIN',
      tenantId: null,
      twoFactorEnabled: true,
    });

    // 2. Tenant A
    const tenantA = await TenantModel.create({
      name: 'Tenant Alpha',
      status: 'active',
      mailboxLimit: 5,
      mailboxCount: 0,
    });
    tenantAId = (tenantA._id as any).toString();

    const domainA = await DomainModel.create({
      tenantId: tenantA._id,
      domainName: 'alpha.test',
      status: 'active',
      dnsStatus: 'active',
    });
    domainAId = (domainA._id as any).toString();

    const adminA = await AdminUserModel.create({
      email: 'admin@alpha.test',
      passwordHash: await hashPassword('TenantAPassword2026!'),
      role: 'TENANT_ADMIN',
      tenantId: tenantA._id,
      status: 'active',
      twoFactorEnabled: true,
    });
    tenantAdminAId = (adminA._id as any).toString();
    tenantAdminAToken = generateOidcToken({
      id: tenantAdminAId,
      email: 'admin@alpha.test',
      role: 'TENANT_ADMIN',
      tenantId: tenantAId,
      twoFactorEnabled: true,
    });

    // 3. Tenant B (Victim / Isolation Target)
    const tenantB = await TenantModel.create({
      name: 'Tenant Beta',
      status: 'active',
      mailboxLimit: 10,
      mailboxCount: 1,
    });
    tenantBId = (tenantB._id as any).toString();

    const domainB = await DomainModel.create({
      tenantId: tenantB._id,
      domainName: 'beta.test',
      status: 'active',
      dnsStatus: 'active',
    });
    domainBId = (domainB._id as any).toString();

    const adminB = await AdminUserModel.create({
      email: 'admin@beta.test',
      passwordHash: await hashPassword('TenantBPassword2026!'),
      role: 'TENANT_ADMIN',
      tenantId: tenantB._id,
      status: 'active',
      twoFactorEnabled: true,
    });
    tenantAdminBId = (adminB._id as any).toString();
    tenantAdminBToken = generateOidcToken({
      id: tenantAdminBId,
      email: 'admin@beta.test',
      role: 'TENANT_ADMIN',
      tenantId: tenantBId,
      twoFactorEnabled: true,
    });

    const mailboxB = await MailboxModel.create({
      tenantId: tenantB._id,
      domainId: domainB._id,
      localPart: 'ceo',
      address: 'ceo@beta.test',
      status: 'active',
      twoFactorEnabled: true,
    });
    mailboxBId = (mailboxB._id as any).toString();
  });

  // =========================================================================
  // PILLAR 1: HIGH-CONCURRENCY ATOMIC QUOTA STRESS TEST
  // =========================================================================
  describe('Pillar 1: High-Concurrency Atomic Quota Stress Test', () => {
    it('guarantees zero over-allocation under concurrent race conditions', async () => {
      // Setup: Tenant A limit is 5. We pre-create 3 mailboxes (2 available spots).
      await TenantModel.findByIdAndUpdate(tenantAId, { mailboxCount: 3 });
      await MailboxModel.create([
        { tenantId: tenantAId, domainId: domainAId, localPart: 'user1', address: 'user1@alpha.test', status: 'active' },
        { tenantId: tenantAId, domainId: domainAId, localPart: 'user2', address: 'user2@alpha.test', status: 'active' },
        { tenantId: tenantAId, domainId: domainAId, localPart: 'user3', address: 'user3@alpha.test', status: 'active' },
      ]);

      // Fire 10 simultaneous concurrent requests racing for the remaining 2 quota spots
      const concurrencyLevel = 10;
      const requestPromises = Array.from({ length: concurrencyLevel }, (_, i) => {
        return request(app)
          .post('/api/tenants/me/mailboxes')
          .set('Authorization', `Bearer ${tenantAdminAToken}`)
          .send({
            localPart: `concurrent-${i + 1}`,
            password: 'StrongMailboxPassword2026!',
          });
      });

      const responses = await Promise.all(requestPromises);

      const successResponses = responses.filter(r => r.status === 201);
      const quotaExceededResponses = responses.filter(r => r.status === 409);

      // Strictly exactly 2 requests must succeed and 8 must be rejected with 409
      expect(successResponses.length).toBe(2);
      expect(quotaExceededResponses.length).toBe(8);

      // Verify all failures returned standardized QUOTA_EXCEEDED error
      quotaExceededResponses.forEach(r => {
        expect(r.body.error).toBe('QUOTA_EXCEEDED');
      });

      // Verify database state is mathematically exact: mailboxCount must be 5
      const updatedTenant = await TenantModel.findById(tenantAId);
      expect(updatedTenant?.mailboxCount).toBe(5);

      // Verify total document count in MongoDB is exactly 5
      const totalMailboxDocuments = await MailboxModel.countDocuments({ tenantId: tenantAId });
      expect(totalMailboxDocuments).toBe(5);
    });
  });

  // =========================================================================
  // PILLAR 2: SECURITY & PENETRATION TESTING
  // =========================================================================
  describe('Pillar 2: Security & Penetration Testing', () => {
    it('prevents Cross-Tenant IDOR: Tenant A cannot view Tenant B mailbox (returns 404)', async () => {
      const res = await request(app)
        .get(`/api/mailboxes/${mailboxBId}`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('MAILBOX_NOT_FOUND');
    });

    it('prevents Cross-Tenant IDOR: Tenant A cannot reset Tenant B mailbox password (returns 404)', async () => {
      const res = await request(app)
        .post(`/api/mailboxes/${mailboxBId}/reset-password`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .send({ newPassword: 'MaliciousHackerPassword2026!' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('MAILBOX_NOT_FOUND');
    });

    it('prevents Cross-Tenant IDOR: Tenant A cannot delete Tenant B mailbox (returns 404)', async () => {
      const res = await request(app)
        .delete(`/api/mailboxes/${mailboxBId}`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('MAILBOX_NOT_FOUND');
    });

    it('prevents Privilege Escalation: Tenant Admin cannot access Platform Admin tenant controls', async () => {
      // 1. List platform tenants
      const listTenantsRes = await request(app)
        .get('/api/platform/tenants')
        .set('Authorization', `Bearer ${tenantAdminAToken}`);
      expect(listTenantsRes.status).toBe(403);

      // 2. Suspend tenant
      const suspendRes = await request(app)
        .post(`/api/platform/tenants/${tenantBId}/suspend`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);
      expect(suspendRes.status).toBe(403);

      // 3. Delete tenant
      const deleteRes = await request(app)
        .delete(`/api/platform/tenants/${tenantBId}`)
        .set('Authorization', `Bearer ${tenantAdminAToken}`);
      expect(deleteRes.status).toBe(403);
    });

    it('prevents Privilege Escalation: Tenant Admin cannot access Super Admin Application Queue', async () => {
      const res = await request(app)
        .get('/api/super-admin/applications')
        .set('Authorization', `Bearer ${tenantAdminAToken}`);
      expect(res.status).toBe(403);
    });

    it('prevents Privilege Escalation: Tenant Admin cannot access System Operations, Health or Backups', async () => {
      const healthRes = await request(app)
        .get('/api/system/health')
        .set('Authorization', `Bearer ${tenantAdminAToken}`);
      expect(healthRes.status).toBe(403);

      const backupRes = await request(app)
        .post('/api/system/backup')
        .set('Authorization', `Bearer ${tenantAdminAToken}`);
      expect(backupRes.status).toBe(403);

      const reconciliationRes = await request(app)
        .get('/api/system/reconciliation')
        .set('Authorization', `Bearer ${tenantAdminAToken}`);
      expect(reconciliationRes.status).toBe(403);
    });

    it('prevents Cross-Portal Authentication: Super Admin cannot log into Tenant Portal', async () => {
      const res = await request(app)
        .post('/api/auth/tenant-admin/login')
        .send({
          email: 'root@toowix.com',
          password: 'SuperSecureAdminPassword2026!',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('AUTH_FAILED');
      expect(res.body.message).toContain('Access Denied: This account is not authorized');
    });

    it('prevents Cross-Portal Authentication: Tenant Admin cannot log into Super Admin Portal', async () => {
      const res = await request(app)
        .post('/api/auth/super-admin/login')
        .send({
          email: 'admin@alpha.test',
          password: 'TenantAPassword2026!',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('AUTH_FAILED');
      expect(res.body.message).toContain('Access Denied: This account is not authorized');
    });

    it('resists Header Spoofing: Backend enforces role directly, ignoring spoofed Origin/Referer headers', async () => {
      const res = await request(app)
        .get('/api/platform/tenants')
        .set('Authorization', `Bearer ${tenantAdminAToken}`)
        .set('Origin', 'http://admin.toowix.com')
        .set('Referer', 'http://admin.toowix.com/dashboard')
        .set('Host', 'admin.toowix.com')
        .set('X-Forwarded-Host', 'admin.toowix.com');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // PILLAR 3: COMPLETE 11-STAGE END-TO-END USER JOURNEY
  // =========================================================================
  describe('Pillar 3: Complete 11-Stage End-to-End User Journey', () => {
    it('executes full multi-tenant lifecycle from registration to cascade teardown', async () => {
      // -----------------------------------------------------------------------
      // STAGE 1: Public Self-Service Registration
      // -----------------------------------------------------------------------
      const regRes = await request(app)
        .post('/api/public/register-tenant')
        .send({
          companyName: 'Wayne Enterprises',
          requestedDomain: 'waynecorp.test',
          applicantName: 'Bruce Wayne',
          contactEmail: 'bruce@wayne-external.test',
          notes: 'Global defense contractor',
        });

      expect(regRes.status).toBe(201);
      expect(regRes.body.success).toBe(true);
      const applicationId = regRes.body.application.id;

      // -----------------------------------------------------------------------
      // STAGE 2: Super Admin Views Review Queue
      // -----------------------------------------------------------------------
      const queueRes = await request(app)
        .get('/api/super-admin/applications?status=PENDING_REVIEW')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(queueRes.status).toBe(200);
      const matchedApp = queueRes.body.applications.find((a: any) => a._id === applicationId);
      expect(matchedApp).toBeDefined();

      // -----------------------------------------------------------------------
      // STAGE 3: Super Admin Approves Application (Auto-Provisions Domain on Stalwart)
      // -----------------------------------------------------------------------
      const approveRes = await request(app)
        .post(`/api/super-admin/applications/${applicationId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.success).toBe(true);
      const newTenantId = approveRes.body.tenant.id;

      const approvedTenant = await TenantModel.findById(newTenantId);
      expect(approvedTenant?.status).toBe('approved_pending_setup');

      // -----------------------------------------------------------------------
      // STAGE 4: Super Admin Activates Tenant (Stalwart Pre-Flight + 48h Token)
      // -----------------------------------------------------------------------
      const activateTriggerRes = await request(app)
        .post(`/api/platform/tenants/${newTenantId}/activate`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(activateTriggerRes.status).toBe(200);
      expect(activateTriggerRes.body.success).toBe(true);
      expect(activateTriggerRes.body.activationLink).toBeDefined();

      const actUrl = new URL(activateTriggerRes.body.activationLink);
      const rawToken = actUrl.searchParams.get('token')!;
      expect(rawToken).toBeDefined();

      // -----------------------------------------------------------------------
      // STAGE 5: Applicant First-Time Onboarding (Password + Mandatory 2FA)
      // -----------------------------------------------------------------------
      // First, get token metadata to obtain TOTP secret
      const tokenMetaRes = await request(app).get(`/api/public/activate-token/${rawToken}`);
      expect(tokenMetaRes.status).toBe(200);
      const totpSecret = tokenMetaRes.body.totpSecret;
      expect(totpSecret).toBeDefined();

      // Generate valid TOTP code
      const totpCode = generateSync({ secret: totpSecret });

      const completeOnboardingRes = await request(app)
        .post('/api/public/activate')
        .send({
          token: rawToken,
          email: 'bruce@waynecorp.test',
          password: 'WayneAdminSecretPassword2026!',
          totpSecret,
          totpCode,
        });

      expect(completeOnboardingRes.status).toBe(200);
      expect(completeOnboardingRes.body.success).toBe(true);

      // Verify single-use: cannot redeem token twice
      const secondAttempt = await request(app)
        .post('/api/public/activate')
        .send({
          token: rawToken,
          email: 'bruce@waynecorp.test',
          password: 'WayneAdminSecretPassword2026!',
          totpSecret,
          totpCode,
        });
      expect(secondAttempt.status).toBe(410);
      expect(secondAttempt.body.error).toBe('TOKEN_ALREADY_USED');

      // -----------------------------------------------------------------------
      // STAGE 6: Tenant Admin Authenticates at manage.toowix.com
      // -----------------------------------------------------------------------
      const loginStep1 = await request(app)
        .post('/api/auth/tenant-admin/login')
        .send({
          email: 'bruce@waynecorp.test',
          password: 'WayneAdminSecretPassword2026!',
        });

      expect(loginStep1.status).toBe(200);
      expect(loginStep1.body.requires2FA).toBe(true);
      const tempToken = loginStep1.body.tempToken;

      const loginStep2 = await request(app)
        .post('/api/auth/2fa/verify')
        .send({
          tempToken,
          code: generateSync({ secret: totpSecret }),
        });

      expect(loginStep2.status).toBe(200);
      expect(loginStep2.body.token).toBeDefined();
      const wayneAdminToken = loginStep2.body.token;

      // -----------------------------------------------------------------------
      // STAGE 7: Tenant Admin Creates Mailboxes & Enforces Quota
      // -----------------------------------------------------------------------
      // Domain is activated by Super Admin before mailbox creation unlocks
      await DomainModel.updateOne({ tenantId: newTenantId }, { dnsStatus: 'active' });

      const mailboxRes = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${wayneAdminToken}`)
        .send({
          localPart: 'alfred',
          password: 'AlfredButlerPassword2026!',
        });

      expect(mailboxRes.status).toBe(201);
      expect(mailboxRes.body.address).toBe('alfred@waynecorp.test');
      const alfredMailboxId = mailboxRes.body.id;

      // -----------------------------------------------------------------------
      // STAGE 8: Mailbox Password Rotation
      // -----------------------------------------------------------------------
      const pwResetRes = await request(app)
        .post(`/api/mailboxes/${alfredMailboxId}/reset-password`)
        .set('Authorization', `Bearer ${wayneAdminToken}`)
        .send({ newPassword: 'AlfredNewSecurePassword2026!' });

      expect(pwResetRes.status).toBe(200);

      // -----------------------------------------------------------------------
      // STAGE 9: Super Admin Suspends Tenant (Full Lockdown)
      // -----------------------------------------------------------------------
      const suspendRes = await request(app)
        .post(`/api/platform/tenants/${newTenantId}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(suspendRes.status).toBe(200);

      // Verify status reflected in /api/tenants/me
      const tenantStatusRes = await request(app)
        .get('/api/tenants/me')
        .set('Authorization', `Bearer ${wayneAdminToken}`);
      expect(tenantStatusRes.status).toBe(200);
      expect(tenantStatusRes.body.tenant.status).toBe('suspended');

      // Verify Full Lockdown: Mailbox creation is blocked
      const lockedOutRes = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${wayneAdminToken}`)
        .send({
          localPart: 'robin',
          password: 'RobinPassword2026!',
        });
      expect(lockedOutRes.status).toBe(403);
      expect(lockedOutRes.body.error).toBe('TENANT_SUSPENDED');

      // Verify mailboxes are suspended and Stalwart domain is disabled
      const suspendedMailbox = await MailboxModel.findOne({ tenantId: newTenantId });
      expect(suspendedMailbox?.status).toBe('suspended');
      const suspendedDom = mockDomains.find((d) => d.name === 'waynecorp.test');
      expect(suspendedDom?.isEnabled).toBe(false);

      // -----------------------------------------------------------------------
      // STAGE 10: Super Admin Reactivates Tenant
      // -----------------------------------------------------------------------
      const reactivateRes = await request(app)
        .post(`/api/platform/tenants/${newTenantId}/reactivate`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(reactivateRes.status).toBe(200);

      // Verify mailboxes are active and Stalwart domain is enabled
      const activeMailbox = await MailboxModel.findOne({ tenantId: newTenantId });
      expect(activeMailbox?.status).toBe('active');
      const activeDom = mockDomains.find((d) => d.name === 'waynecorp.test');
      expect(activeDom?.isEnabled).toBe(true);

      // Verify access restored: tenant is active and mailbox creation works
      const restoredRes = await request(app)
        .get('/api/tenants/me')
        .set('Authorization', `Bearer ${wayneAdminToken}`);
      expect(restoredRes.status).toBe(200);
      expect(restoredRes.body.tenant.status).toBe('active');

      const restoredMailboxRes = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${wayneAdminToken}`)
        .send({
          localPart: 'robin',
          password: 'RobinPassword2026!',
        });
      expect(restoredMailboxRes.status).toBe(201);

      // -----------------------------------------------------------------------
      // STAGE 11: AES-256 Backup, Drift Reconciliation & Cascade Deletion
      // -----------------------------------------------------------------------
      // 1. Create and verify system backup
      const backupRes = await request(app)
        .post('/api/system/backup')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(backupRes.status).toBe(201);

      const verifyRes = await request(app)
        .post(`/api/system/backups/${backupRes.body.backup.id}/verify`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(verifyRes.body.valid).toBe(true);

      // 2. Cascade delete tenant
      const cascadeDeleteRes = await request(app)
        .delete(`/api/platform/tenants/${newTenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(cascadeDeleteRes.status).toBe(200);

      // Verify all MongoDB records are cleanly purged
      const tenantCheck = await TenantModel.findById(newTenantId);
      expect(tenantCheck).toBeNull();

      const domainCheck = await DomainModel.findOne({ domainName: 'waynecorp.test' });
      expect(domainCheck).toBeNull();

      const mailboxCheck = await MailboxModel.findOne({ address: 'alfred@waynecorp.test' });
      expect(mailboxCheck).toBeNull();

      const adminCheck = await AdminUserModel.findOne({ email: 'bruce@waynecorp.test' });
      expect(adminCheck).toBeNull();

      // Verify audit trail recorded TENANT_DELETED
      const deleteAudit = await AuditLogModel.findOne({ action: 'TENANT_DELETED', resourceId: newTenantId });
      expect(deleteAudit).not.toBeNull();
    });
  });
});
