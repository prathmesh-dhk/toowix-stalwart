import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../src/app';
import {
  TenantModel,
  DomainModel,
  AdminUserModel,
  MailboxModel,
  AdminSessionModel,
  AuditLogModel,
  OrganisationDeletionModel,
  BlockedRegistrationIdentityModel,
} from '../src/db/models';
import { generateOidcToken } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';
import { emailService } from '../src/services/email.service';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-09-21T10:00:00.000Z');
const PUBLIC_IPV6 = '2001:db8::5';
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

describe('organisation deletion — HTTP flow and permanent audit record', () => {
  let mongod: MongoMemoryServer;
  let tenantId: string;
  let ownerId: string;
  let superAdminId: string;
  let sentOtps: string[];

  const setNow = (ms: number) => vi.setSystemTime(new Date(T0.getTime() + ms));
  // Tokens carry an expiry, so mint them against the (faked) current time on every call.
  const tenantToken = () =>
    generateOidcToken({ id: ownerId, email: 'owner@acme.com', role: 'TENANT_ADMIN', tenantId, twoFactorEnabled: false }, 'sess-tenant-1');
  const superToken = () =>
    generateOidcToken({ id: superAdminId, email: 'root@toowix.com', role: 'SUPER_ADMIN', tenantId: null, twoFactorEnabled: false });

  const tenantCall = (method: 'get' | 'post', path: string, body?: object) =>
    request(app)[method](`/api/tenants/me/deletion${path}`)
      .set('Authorization', `Bearer ${tenantToken()}`)
      .set('X-Forwarded-For', PUBLIC_IPV6)
      .set('User-Agent', CHROME_WINDOWS)
      .send(body);

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    setNow(0);

    await Promise.all(
      [TenantModel, DomainModel, AdminUserModel, AdminSessionModel, MailboxModel, AuditLogModel, OrganisationDeletionModel, BlockedRegistrationIdentityModel].map((m) =>
        (m as mongoose.Model<any>).deleteMany({})
      )
    );

    vi.spyOn(stalwartClient, 'updateDomainStatus').mockResolvedValue();
    vi.spyOn(stalwartClient, 'updateAccountStatus').mockResolvedValue();
    vi.spyOn(stalwartClient, 'listAccounts').mockResolvedValue([]);
    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([]);
    vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();
    vi.spyOn(stalwartClient, 'deleteDomain').mockResolvedValue();

    sentOtps = [];
    vi.spyOn(emailService, 'sendOrganisationDeletionOtpEmail').mockImplementation(async (params) => {
      sentOtps.push(params.otpCode);
      return { success: true };
    });
    // Geo lookup for public IPs goes through ip-api.com — never hit the network from tests.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success', country: 'India', countryCode: 'IN', regionName: 'Maharashtra', city: 'Mumbai' }),
    } as Response);

    const tenant = await TenantModel.create({ name: 'Acme Corp', contactEmail: 'owner@acme.com', status: 'active', mailboxLimit: 50, mailboxCount: 0 });
    tenantId = tenant._id.toString();
    const owner = await AdminUserModel.create({
      email: 'owner@acme.com',
      name: 'Olivia Owner',
      passwordHash: 'x',
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
      status: 'active',
      twoFactorEnabled: false,
    });
    ownerId = owner._id.toString();
    // The token carries this session id, so requireAuth checks it against a real, unexpired session.
    await AdminSessionModel.create({ userId: owner._id, sessionId: 'sess-tenant-1', expiresAt: new Date('2030-01-01') });
    const root = await AdminUserModel.create({ email: 'root@toowix.com', name: 'Priya Root', passwordHash: 'x', role: 'SUPER_ADMIN', status: 'active', twoFactorEnabled: false });
    superAdminId = root._id.toString();
    await DomainModel.create({ tenantId, domainName: 'acme.com', status: 'active', dnsStatus: 'active', isPrimary: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const runFullDeletionAsTenantAdmin = async () => {
    setNow(0);
    expect((await tenantCall('post', '', { reason: 'Winding down' })).status).toBe(201);
    setNow(7 * DAY);
    expect((await tenantCall('post', '/confirm-name', { organisationName: 'Acme Corp' })).status).toBe(200);
    setNow(8 * DAY);
    expect((await tenantCall('post', '/otp/initiate')).status).toBe(200);
    setNow(9 * DAY);
    expect((await tenantCall('post', '/otp/generate')).status).toBe(200);
    expect((await tenantCall('post', '/otp/verify', { code: sentOtps[0] })).status).toBe(200);
    return tenantCall('post', '/complete');
  };

  describe('tenant admin drives the flow', () => {
    it('walks the whole timeline over HTTP, gating each step on the clock', async () => {
      const started = await tenantCall('post', '', { reason: 'Winding down' });
      expect(started.status).toBe(201);
      expect(started.body.deletion).toMatchObject({ stage: 'requested', nextAction: 'confirm_name' });
      expect((await TenantModel.findById(tenantId))!.status).toBe('pending_deletion');

      const status = await tenantCall('get', '');
      expect(status.status).toBe(200);
      expect(status.body.deletion.stage).toBe('requested');
      expect(status.body.timings).toMatchObject({ suspensionDays: 7, securityWaitHours: 24, otpWindowHours: 24, finalLockHours: 24 });

      setNow(6 * DAY);
      const early = await tenantCall('post', '/confirm-name', { organisationName: 'Acme Corp' });
      expect(early.status).toBe(409);
      expect(early.body.error).toBe('STEP_NOT_AVAILABLE_YET');
      expect(new Date(early.body.availableAt).toISOString()).toBe(new Date(T0.getTime() + 7 * DAY).toISOString());

      setNow(7 * DAY);
      const wrong = await tenantCall('post', '/confirm-name', { organisationName: 'acme corp' });
      expect(wrong.status).toBe(400);
      expect(wrong.body.error).toBe('ORGANISATION_NAME_MISMATCH');

      const confirmed = await tenantCall('post', '/confirm-name', { organisationName: 'Acme Corp' });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.deletion).toMatchObject({ stage: 'name_confirmed', nextAction: 'initiate_otp' });

      // The 24-hour security wait now applies to the next step.
      const tooSoon = await tenantCall('post', '/otp/initiate');
      expect(tooSoon.status).toBe(409);
      expect(tooSoon.body.error).toBe('STEP_NOT_AVAILABLE_YET');

      const cancelled = await tenantCall('post', '/cancel');
      expect(cancelled.status).toBe(200);
      expect((await TenantModel.findById(tenantId))!.status).toBe('active');
      expect((await tenantCall('get', '')).body.deletion).toBeNull();
    });

    it('rejects a malformed OTP body before touching the deletion', async () => {
      await tenantCall('post', '');
      const res = await tenantCall('post', '/otp/verify', { code: 'abc' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('requires a tenant admin token', async () => {
      const res = await request(app).get('/api/tenants/me/deletion');
      expect(res.status).toBe(401);
    });
  });

  describe('permanent audit record', () => {
    it('answers who deleted the org, with what role, when, from which IP/location/device, and which steps they passed', async () => {
      const final = await runFullDeletionAsTenantAdmin();
      expect(final.status).toBe(200);
      expect(final.body.deletion.stage).toBe('completed');
      expect(await TenantModel.findById(tenantId)).toBeNull();

      const list = await request(app).get('/api/platform/deleted-organisations').set('Authorization', `Bearer ${superToken()}`);
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({
        organisationName: 'Acme Corp',
        organisationId: tenantId,
        registrationEmail: 'owner@acme.com',
        domains: ['acme.com'],
        stage: 'completed',
        initiatedBy: { name: 'Olivia Owner', role: 'TENANT_ADMIN' },
        completedBy: { name: 'Olivia Owner', role: 'TENANT_ADMIN', email: 'owner@acme.com' },
        otpVerification: 'verified',
      });

      const detail = await request(app).get(`/api/platform/deleted-organisations/${list.body.items[0].id}`).set('Authorization', `Bearer ${superToken()}`);
      expect(detail.status).toBe(200);
      const record = detail.body.record;

      expect(new Date(record.initiatedAt).toISOString()).toBe(T0.toISOString());
      expect(new Date(record.completedAt).toISOString()).toBe(new Date(T0.getTime() + 9 * DAY).toISOString());
      expect(record.organisationCreatedAt).toBeTruthy();
      expect(record.emailRestriction).toMatchObject({ email: 'owner@acme.com', permanent: true });
      expect(record.reRegistration.status).toBe('blocked');

      // Every security step carries the actor plus full network/device context, IPv6 included.
      expect(record.timeline.map((e: any) => e.stage)).toEqual([
        'requested',
        'name_confirmed', // the wrong-name attempt is not in this run; only the successful one
        'otp_initiated',
        'otp_generation',
        'otp_verified',
        'final_confirmation',
      ]);
      for (const entry of record.timeline) {
        expect(entry.success).toBe(true);
        expect(entry.actor).toMatchObject({ userId: ownerId, name: 'Olivia Owner', email: 'owner@acme.com', role: 'TENANT_ADMIN', organisationId: tenantId, organisationName: 'Acme Corp' });
        expect(entry.network).toMatchObject({
          ip: PUBLIC_IPV6,
          ipVersion: 6,
          location: 'Mumbai, Maharashtra',
          countryCode: 'IN',
          deviceType: 'desktop',
          os: 'Windows 10/11',
          browser: 'Google Chrome',
          browserVersion: '126.0.0.0',
          sessionId: 'sess-tenant-1',
        });
      }

      // The OTP hash never leaves the server.
      expect(JSON.stringify(detail.body)).not.toMatch(/codeHash|finalOtp/);
    });

    it('also lands every stage in the platform audit log', async () => {
      await runFullDeletionAsTenantAdmin();
      const actions = (await AuditLogModel.find({ action: /^ORG_DELETION_/ }).sort({ timestamp: 1 })).map((a) => a.action);
      expect(actions).toEqual([
        'ORG_DELETION_REQUESTED',
        'ORG_DELETION_NAME_CONFIRMED',
        'ORG_DELETION_OTP_INITIATED',
        'ORG_DELETION_FINAL_OTP_GENERATED',
        'ORG_DELETION_OTP_VERIFIED',
        'ORG_DELETION_COMPLETED',
      ]);
    });

    it('captures the device of whoever performs a step — a different device mid-flow is recorded as such', async () => {
      await tenantCall('post', '', {});
      setNow(7 * DAY);
      const res = await request(app)
        .post('/api/tenants/me/deletion/confirm-name')
        .set('Authorization', `Bearer ${tenantToken()}`)
        .set('X-Forwarded-For', '10.20.30.40')
        .set('User-Agent', SAFARI_IPHONE)
        .send({ organisationName: 'Acme Corp' });
      expect(res.status).toBe(200);

      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record!.timeline[0].network).toMatchObject({ ip: PUBLIC_IPV6, deviceType: 'desktop', browser: 'Google Chrome' });
      expect(record!.timeline[1].network).toMatchObject({
        ip: '10.20.30.40',
        ipVersion: 4,
        location: 'Private Network',
        deviceType: 'mobile',
        os: 'iOS',
        browser: 'Apple Safari',
        browserVersion: '17.5',
      });
    });

    it('is visible to super admins only', async () => {
      await runFullDeletionAsTenantAdmin();
      const other = await AdminUserModel.create({ email: 'someone@other.com', passwordHash: 'x', role: 'TENANT_ADMIN', tenantId: new mongoose.Types.ObjectId(), status: 'active', twoFactorEnabled: false });
      const token = generateOidcToken({ id: other._id.toString(), email: other.email, role: 'TENANT_ADMIN', tenantId: other.tenantId!.toString(), twoFactorEnabled: false });

      const res = await request(app).get('/api/platform/deleted-organisations').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('lists in-progress deletions separately from completed ones', async () => {
      await tenantCall('post', '', {});

      const completed = await request(app).get('/api/platform/deleted-organisations').set('Authorization', `Bearer ${superToken()}`);
      expect(completed.body.items).toHaveLength(0);

      const active = await request(app).get('/api/platform/deleted-organisations?stage=active').set('Authorization', `Bearer ${superToken()}`);
      expect(active.body.items).toHaveLength(1);
      expect(active.body.items[0]).toMatchObject({ organisationName: 'Acme Corp', stage: 'requested' });
    });
  });

  describe('while the organisation is suspended for deletion', () => {
    it('refuses changes through the tenant API but still allows reads and the deletion flow', async () => {
      await tenantCall('post', '');

      const write = await request(app)
        .post('/api/tenants/me/domains')
        .set('Authorization', `Bearer ${tenantToken()}`)
        .send({ domainName: 'sneaky.com' });
      expect(write.status).toBe(423);
      expect(write.body.error).toBe('ORGANISATION_PENDING_DELETION');

      const read = await request(app).get('/api/tenants/me').set('Authorization', `Bearer ${tenantToken()}`);
      expect(read.status).toBe(200);
      expect((await tenantCall('post', '/cancel')).status).toBe(200);
    });

    it('also keeps mailboxes frozen — the separate mailbox API cannot reactivate them mid-suspension', async () => {
      const domain = await DomainModel.findOne({ tenantId });
      const mailbox = await MailboxModel.create({ tenantId, domainId: domain!._id, localPart: 'ceo', address: 'ceo@acme.com', stalwartAccountId: 'acc-1', status: 'active' });
      await tenantCall('post', '');
      expect((await MailboxModel.findById(mailbox._id))!.status).toBe('suspended');

      const res = await request(app).post(`/api/mailboxes/${mailbox._id}/reactivate`).set('Authorization', `Bearer ${tenantToken()}`);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect((await MailboxModel.findById(mailbox._id))!.status).toBe('suspended');
    });

    it('does not claim the registration email is blocked until the deletion actually completes', async () => {
      await tenantCall('post', '');
      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record!.reRegistration.status).toBe('none');
      expect(await BlockedRegistrationIdentityModel.countDocuments({})).toBe(0);
    });

    it('stops a super admin from suspending or reactivating it out from under the flow', async () => {
      await tenantCall('post', '');
      for (const action of ['suspend', 'reactivate']) {
        const res = await request(app).post(`/api/platform/tenants/${tenantId}/${action}`).set('Authorization', `Bearer ${superToken()}`);
        expect(res.status, action).toBe(409);
        expect(res.body.error).toBe('DELETION_IN_PROGRESS');
      }
      expect((await TenantModel.findById(tenantId))!.status).toBe('pending_deletion');
    });
  });

  describe('super admin drives the flow', () => {
    it('is recorded as a super admin acting on the organisation', async () => {
      const res = await request(app)
        .post(`/api/platform/tenants/${tenantId}/deletion`)
        .set('Authorization', `Bearer ${superToken()}`)
        .set('X-Forwarded-For', '10.9.9.9')
        .set('User-Agent', CHROME_WINDOWS)
        .send({ reason: 'Contract terminated' });
      expect(res.status).toBe(201);

      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record!.initiatedBy).toMatchObject({ role: 'SUPER_ADMIN', name: 'Priya Root', email: 'root@toowix.com', organisationId: tenantId, organisationName: 'Acme Corp' });
      expect(record!.reason).toBe('Contract terminated');

      const cancelled = await request(app).post(`/api/platform/tenants/${tenantId}/deletion/cancel`).set('Authorization', `Bearer ${superToken()}`);
      expect(cancelled.status).toBe(200);
      expect((await TenantModel.findById(tenantId))!.status).toBe('active');
    });

    it('rejects a malformed tenant id', async () => {
      const res = await request(app).get('/api/platform/tenants/not-an-id/deletion').set('Authorization', `Bearer ${superToken()}`);
      expect(res.status).toBe(400);
    });
  });

  describe('legacy immediate super-admin delete', () => {
    it('still works, but now leaves the same permanent record and blocks the email', async () => {
      const res = await request(app)
        .delete(`/api/platform/tenants/${tenantId}`)
        .set('Authorization', `Bearer ${superToken()}`)
        .set('X-Forwarded-For', '10.9.9.9')
        .set('User-Agent', CHROME_WINDOWS);
      expect(res.status).toBe(200);
      expect(await TenantModel.findById(tenantId)).toBeNull();

      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record).toMatchObject({ stage: 'completed', path: 'forced', organisationName: 'Acme Corp', registrationEmail: 'owner@acme.com' });
      expect(record!.completedBy).toMatchObject({ role: 'SUPER_ADMIN', email: 'root@toowix.com' });
      expect(record!.completedNetwork).toMatchObject({ ip: '10.9.9.9', browser: 'Google Chrome' });
      expect(await BlockedRegistrationIdentityModel.findOne({ emailNormalized: 'owner@acme.com' })).not.toBeNull();
      expect(await AuditLogModel.findOne({ action: 'TENANT_DELETED', resourceId: tenantId })).not.toBeNull();
    });
  });
});
