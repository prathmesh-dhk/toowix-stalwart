import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { AdminUserModel, TenantModel, DomainModel, MailboxModel, AuditLogModel, PlanModel, DomainSubscriptionModel } from '../src/db/models';
import { generateOidcToken } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';

let mongoServer: MongoMemoryServer;

describe('Tenant Moderator accounts — scoped mailbox-only sub-users', () => {
  let tenantId: string;
  let tenantAdminToken: string;
  let domainAId: string;
  let domainBId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri() });

    vi.spyOn(stalwartClient, 'createAccount').mockImplementation(async (input) => ({
      id: 'mock-acc-' + Math.random().toString(36).slice(7),
      name: input.name,
      domainId: input.domainId,
      emailAddress: `${input.name}@mock.test`,
    }));
    vi.spyOn(stalwartClient, 'updateAccountPassword').mockResolvedValue();
    vi.spyOn(stalwartClient, 'updateAccountStatus').mockResolvedValue();
    vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await disconnectDatabase();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await Promise.all(
      [TenantModel, DomainModel, AdminUserModel, MailboxModel, AuditLogModel, PlanModel, DomainSubscriptionModel].map((m) =>
        m.deleteMany({})
      )
    );

    const tenant = await TenantModel.create({ name: 'Acme Corp', status: 'active', mailboxLimit: 50, mailboxCount: 0 });
    tenantId = tenant._id.toString();
    const plan = await PlanModel.create({ name: 'Team', seatCount: 10, displayOrder: 1, isActive: true });

    const domainA = await DomainModel.create({ tenantId, domainName: 'acme.test', status: 'active', dnsStatus: 'active' });
    domainAId = domainA._id.toString();
    const domainB = await DomainModel.create({ tenantId, domainName: 'other.test', status: 'active', dnsStatus: 'active' });
    domainBId = domainB._id.toString();
    for (const domainId of [domainAId, domainBId]) {
      await DomainSubscriptionModel.create({
        domainId,
        tenantId,
        planId: plan._id,
        stripeSubscriptionId: `sub_${domainId}`,
        stripeSubscriptionItemId: `si_${domainId}`,
        status: 'trialing',
      });
    }

    const admin = await AdminUserModel.create({
      email: 'owner@acme.test',
      passwordHash: 'argon2id$mocked',
      role: 'TENANT_ADMIN',
      tenantId,
      status: 'active',
      twoFactorEnabled: true,
    });
    tenantAdminToken = generateOidcToken({
      id: admin._id.toString(),
      email: admin.email,
      role: 'TENANT_ADMIN',
      tenantId,
      twoFactorEnabled: true,
    });
  });

  async function createModerator(scopedDomainIds: string[] = [domainAId]) {
    const res = await request(app)
      .post('/api/tenants/me/moderators')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ email: 'mod@acme.test', password: 'Password123!', scopedDomainIds });
    return res;
  }

  function moderatorToken(moderatorId: string) {
    return generateOidcToken({
      id: moderatorId,
      email: 'mod@acme.test',
      role: 'TENANT_MODERATOR',
      tenantId,
      twoFactorEnabled: false,
    });
  }

  describe('Tenant Admin CRUD for Moderator accounts', () => {
    it('creates a Moderator scoped to specific domains', async () => {
      const res = await createModerator([domainAId]);
      expect(res.status).toBe(201);
      expect(res.body.moderator).toMatchObject({ email: 'mod@acme.test', role: 'TENANT_MODERATOR', scopedDomainIds: [domainAId] });

      const stored = await AdminUserModel.findOne({ email: 'mod@acme.test' });
      expect(stored!.role).toBe('TENANT_MODERATOR');
      expect(stored!.scopedDomainIds.map((id) => id.toString())).toEqual([domainAId]);
    });

    it('rejects a scope that names a domain outside this tenant', async () => {
      const res = await createModerator([new (await import('mongoose')).default.Types.ObjectId().toString()]);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('DOMAIN_NOT_FOUND');
      expect(await AdminUserModel.countDocuments({ role: 'TENANT_MODERATOR' })).toBe(0);
    });

    it('lists Moderators for this tenant', async () => {
      await createModerator();
      const res = await request(app).get('/api/tenants/me/moderators').set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.moderators).toHaveLength(1);
      expect(res.body.moderators[0].email).toBe('mod@acme.test');
    });

    it("updates a Moderator's scope and status", async () => {
      const created = await createModerator([domainAId]);
      const id = created.body.moderator.id;

      const res = await request(app)
        .patch(`/api/tenants/me/moderators/${id}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ scopedDomainIds: [domainAId, domainBId], status: 'disabled' });

      expect(res.status).toBe(200);
      expect(res.body.moderator).toMatchObject({ status: 'disabled', scopedDomainIds: [domainAId, domainBId] });
    });

    it('removes a Moderator account', async () => {
      const created = await createModerator();
      const id = created.body.moderator.id;

      const res = await request(app).delete(`/api/tenants/me/moderators/${id}`).set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(res.status).toBe(200);
      expect(await AdminUserModel.findById(id)).toBeNull();
    });

    it('a Moderator cannot manage other Moderator accounts (route is Tenant-Admin-only)', async () => {
      const created = await createModerator();
      const token = moderatorToken(created.body.moderator.id);

      const res = await request(app).get('/api/tenants/me/moderators').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('Moderator login and dashboard scope', () => {
    it('logs in through the tenant-admin portal like a Tenant Admin', async () => {
      const created = await createModerator();
      await AdminUserModel.updateOne({ _id: created.body.moderator.id }, { passwordHash: await (await import('../src/auth/service')).hashPassword('Password123!') });

      const res = await request(app)
        .post('/api/auth/tenant-admin/login')
        .send({ email: 'mod@acme.test', password: 'Password123!' });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('TENANT_MODERATOR');
    });

    it('GET /me and /me/domains only show the Moderator their scoped domain, not the tenant\'s other one', async () => {
      const created = await createModerator([domainAId]);
      const token = moderatorToken(created.body.moderator.id);

      const meRes = await request(app).get('/api/tenants/me').set('Authorization', `Bearer ${token}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.tenant.domains.map((d: any) => d.id)).toEqual([domainAId]);

      const domainsRes = await request(app).get('/api/tenants/me/domains').set('Authorization', `Bearer ${token}`);
      expect(domainsRes.status).toBe(200);
      expect(domainsRes.body.domains.map((d: any) => d.id)).toEqual([domainAId]);
    });

    it('blocks a Moderator from billing, domain management, and security-ip routes (403)', async () => {
      const created = await createModerator([domainAId]);
      const token = moderatorToken(created.body.moderator.id);

      const billing = await request(app).get('/api/tenants/me/billing/summary').set('Authorization', `Bearer ${token}`);
      expect(billing.status).toBe(403);

      const createDomain = await request(app)
        .post('/api/tenants/me/domains')
        .set('Authorization', `Bearer ${token}`)
        .send({ domainName: 'new.test', planId: 'x' });
      expect(createDomain.status).toBe(403);

      const deletion = await request(app).get('/api/tenants/me/deletion/status').set('Authorization', `Bearer ${token}`);
      expect(deletion.status).toBe(403);
    });

    it('a disabled Moderator is rejected even with a still-valid token', async () => {
      const created = await createModerator([domainAId]);
      await AdminUserModel.updateOne({ _id: created.body.moderator.id }, { status: 'disabled' });
      const token = moderatorToken(created.body.moderator.id);

      const res = await request(app).get('/api/tenants/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('Mailbox management within scope', () => {
    it('creates a mailbox on a scoped domain', async () => {
      const created = await createModerator([domainAId]);
      const token = moderatorToken(created.body.moderator.id);

      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${token}`)
        .send({ localPart: 'sales', password: 'Password123!', domainId: domainAId });

      expect(res.status).toBe(201);
      expect(res.body.address).toBe('sales@acme.test');
    });

    it('refuses to create a mailbox on a domain outside scope', async () => {
      const created = await createModerator([domainAId]);
      const token = moderatorToken(created.body.moderator.id);

      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${token}`)
        .send({ localPart: 'sales', password: 'Password123!', domainId: domainBId });

      expect(res.status).toBe(404);
      expect(await MailboxModel.countDocuments({})).toBe(0);
    });

    it('refuses to create a mailbox with no domainId (would otherwise default to the primary domain, bypassing scope)', async () => {
      const created = await createModerator([domainAId]);
      const token = moderatorToken(created.body.moderator.id);

      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${token}`)
        .send({ localPart: 'sales', password: 'Password123!' });

      expect(res.status).toBe(404);
    });

    it('GET /mailboxes only returns mailboxes on scoped domains, never the whole tenant', async () => {
      const created = await createModerator([domainAId]);
      const token = moderatorToken(created.body.moderator.id);

      await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${token}`)
        .send({ localPart: 'sales', password: 'Password123!', domainId: domainAId });

      // Tenant Admin creates one on the out-of-scope domain too.
      await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ localPart: 'support', password: 'Password123!', domainId: domainBId });

      const res = await request(app).get('/api/tenants/me/mailboxes').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.mailboxes).toHaveLength(1);
      expect(res.body.mailboxes[0].address).toBe('sales@acme.test');
    });

    it('suspend/reactivate/reset-password/delete succeed on an in-scope mailbox', async () => {
      const created = await createModerator([domainAId]);
      const token = moderatorToken(created.body.moderator.id);

      const createRes = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${token}`)
        .send({ localPart: 'sales', password: 'Password123!', domainId: domainAId });
      const mailboxId = createRes.body.id;

      const suspend = await request(app).post(`/api/mailboxes/${mailboxId}/suspend`).set('Authorization', `Bearer ${token}`);
      expect(suspend.status).toBe(200);

      const reactivate = await request(app).post(`/api/mailboxes/${mailboxId}/reactivate`).set('Authorization', `Bearer ${token}`);
      expect(reactivate.status).toBe(200);

      const resetPw = await request(app)
        .post(`/api/mailboxes/${mailboxId}/reset-password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ newPassword: 'NewPassword123!' });
      expect(resetPw.status).toBe(200);

      const del = await request(app).delete(`/api/mailboxes/${mailboxId}`).set('Authorization', `Bearer ${token}`);
      expect(del.status).toBe(200);
      expect(await MailboxModel.findById(mailboxId)).toBeNull();
    });

    it('suspend/reactivate/reset-password/delete all 404 on an out-of-scope mailbox (not 403 — avoids confirming it exists)', async () => {
      const created = await createModerator([domainAId]);
      const token = moderatorToken(created.body.moderator.id);

      const outOfScope = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ localPart: 'support', password: 'Password123!', domainId: domainBId });
      const mailboxId = outOfScope.body.id;

      const suspend = await request(app).post(`/api/mailboxes/${mailboxId}/suspend`).set('Authorization', `Bearer ${token}`);
      expect(suspend.status).toBe(404);

      const reactivate = await request(app).post(`/api/mailboxes/${mailboxId}/reactivate`).set('Authorization', `Bearer ${token}`);
      expect(reactivate.status).toBe(404);

      const resetPw = await request(app)
        .post(`/api/mailboxes/${mailboxId}/reset-password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ newPassword: 'NewPassword123!' });
      expect(resetPw.status).toBe(404);

      const getOne = await request(app).get(`/api/mailboxes/${mailboxId}`).set('Authorization', `Bearer ${token}`);
      expect(getOne.status).toBe(404);

      const del = await request(app).delete(`/api/mailboxes/${mailboxId}`).set('Authorization', `Bearer ${token}`);
      expect(del.status).toBe(404);
      // Confirm it's untouched.
      expect(await MailboxModel.findById(mailboxId)).not.toBeNull();
    });

    it("revoking a domain from a Moderator's scope blocks them immediately, without a new login", async () => {
      const created = await createModerator([domainAId]);
      const token = moderatorToken(created.body.moderator.id);

      const createRes = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${token}`)
        .send({ localPart: 'sales', password: 'Password123!', domainId: domainAId });
      expect(createRes.status).toBe(201);

      await request(app)
        .patch(`/api/tenants/me/moderators/${created.body.moderator.id}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ scopedDomainIds: [] });

      // Same token, same session — no re-login — yet access is gone immediately.
      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${token}`)
        .send({ localPart: 'support', password: 'Password123!', domainId: domainAId });
      expect(res.status).toBe(404);
    });
  });

  describe("Super Admin console visibility", () => {
    it("shows Moderator accounts alongside the Tenant Admin in the tenant's Administrators list", async () => {
      await createModerator([domainAId]);

      const superAdmin = await AdminUserModel.create({
        email: 'super@toowix.test',
        passwordHash: 'argon2id$mocked',
        role: 'SUPER_ADMIN',
        status: 'active',
        twoFactorEnabled: true,
      });
      const superToken = generateOidcToken({
        id: superAdmin._id.toString(),
        email: superAdmin.email,
        role: 'SUPER_ADMIN',
        tenantId: null,
        twoFactorEnabled: true,
      });

      const res = await request(app).get(`/api/platform/tenants/${tenantId}`).set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(200);
      const roles = res.body.admins.map((a: any) => a.role).sort();
      expect(roles).toEqual(['TENANT_ADMIN', 'TENANT_MODERATOR']);
    });
  });
});
