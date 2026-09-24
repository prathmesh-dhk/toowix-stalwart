import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { AdminUserModel, TenantModel, DomainModel, PlanModel, DomainSubscriptionModel, MailboxModel } from '../src/db/models';
import { generateOidcToken } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';
import { emailService } from '../src/services/email.service';
import { runHeldMailboxSweepOnce } from '../src/jobs/held-mailbox-sweep.job';
import { HELD_MAILBOX_LIMIT } from '../src/services/mailbox.service';

let mongoServer: MongoMemoryServer;
const DAY = 24 * 60 * 60 * 1000;

describe('held (unactivated) mailboxes', () => {
  let tenantId: string;
  let domainId: string;
  let token: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri(), autoIndex: true });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([AdminUserModel, TenantModel, DomainModel, PlanModel, DomainSubscriptionModel, MailboxModel].map((m) => m.deleteMany({})));

    const tenant = await TenantModel.create({ name: 'Acme', contactEmail: 'owner@acme.test', status: 'active', mailboxLimit: 100, mailboxCount: 0 });
    tenantId = tenant._id.toString();
    const plan = await PlanModel.create({ name: 'Team', seatCount: 50, displayOrder: 1, isActive: true, billingMode: 'fixed', monthlyPriceInPaise: 10000 });
    const domain = await DomainModel.create({ tenantId, domainName: 'acme.com', planId: plan._id, planName: 'Team', mailboxLimit: 50, status: 'active', dnsStatus: 'active', isPrimary: true });
    domainId = domain._id.toString();
    const admin = await AdminUserModel.create({ email: 'admin@acme.test', passwordHash: 'x', role: 'TENANT_ADMIN', tenantId: tenant._id, status: 'active', twoFactorEnabled: false });
    token = generateOidcToken({ id: admin._id.toString(), email: admin.email, role: 'TENANT_ADMIN', tenantId, twoFactorEnabled: false });

    let n = 0;
    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([{ id: 'sd-1', name: 'acme.com' } as any]);
    vi.spyOn(stalwartClient, 'createAccount').mockImplementation(async () => ({ id: `acc-${++n}`, name: 'x' }) as any);
    vi.spyOn(stalwartClient, 'updateAccountStatus').mockResolvedValue(undefined as any);
    vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue(undefined as any);
    vi.spyOn(emailService, 'sendBillingNoticeEmail').mockResolvedValue({ success: true });
  });

  const create = (localPart: string) =>
    request(app).post('/api/tenants/me/mailboxes').set('Authorization', `Bearer ${token}`).send({ localPart, password: 'Password123!', domainId });

  it(`caps unactivated mailboxes at ${HELD_MAILBOX_LIMIT} and rolls the quota back on refusal`, async () => {
    for (let i = 0; i < HELD_MAILBOX_LIMIT; i++) expect((await create(`user${i}`)).status).toBe(201);

    const refused = await create('one-too-many');
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('HELD_LIMIT_REACHED');
    expect(refused.body.message).toMatch(/Cart/);
    expect(await MailboxModel.countDocuments({ tenantId })).toBe(HELD_MAILBOX_LIMIT);
    expect((await TenantModel.findById(tenantId))!.mailboxCount).toBe(HELD_MAILBOX_LIMIT);
  });

  it('the cap only applies before activation — once the trial runs, users are unlimited', async () => {
    for (let i = 0; i < HELD_MAILBOX_LIMIT; i++) await create(`user${i}`);
    await TenantModel.updateOne({ _id: tenantId }, { trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 60 * DAY), stripeSubscriptionId: `sub_trial_${tenantId}` });

    const res = await create('after-trial');
    expect(res.status).toBe(201);
    expect(res.body.billingHold).toBe(false);
  });

  it('the cart shows when each waiting mailbox expires (14 days after creation)', async () => {
    await create('john');
    const cart = await request(app).get('/api/tenants/me/cart').set('Authorization', `Bearer ${token}`);
    const [pending] = cart.body.pendingMailboxes;
    expect(new Date(pending.expiresAt).getTime() - new Date(pending.createdAt).getTime()).toBe(14 * DAY);
  });

  describe('sweep', () => {
    it('warns once at day 10 (one email per tenant listing the mailboxes) and does not touch younger ones', async () => {
      await create('old1');
      await create('old2');
      await create('young');
      await MailboxModel.collection.updateMany({ localPart: { $in: ['old1', 'old2'] } }, { $set: { createdAt: new Date(Date.now() - 11 * DAY) } });

      const first = await runHeldMailboxSweepOnce();
      expect(first).toEqual({ warned: 2, expired: 0 });
      expect(emailService.sendBillingNoticeEmail).toHaveBeenCalledTimes(1);
      const mail = vi.mocked(emailService.sendBillingNoticeEmail).mock.calls[0][0];
      expect(mail.to).toBe('owner@acme.test');
      expect(mail.paragraphs.join(' ')).toContain('old1@acme.com');
      expect(mail.paragraphs.join(' ')).not.toContain('young@acme.com');

      const second = await runHeldMailboxSweepOnce();
      expect(second).toEqual({ warned: 0, expired: 0 });
      expect(emailService.sendBillingNoticeEmail).toHaveBeenCalledTimes(1);
    });

    it('removes mailboxes still unactivated at day 14 (Stalwart + Mongo) and frees the quota', async () => {
      await create('stale');
      await create('fresh');
      await MailboxModel.collection.updateOne({ localPart: 'stale' }, { $set: { createdAt: new Date(Date.now() - 15 * DAY) } });
      expect((await TenantModel.findById(tenantId))!.mailboxCount).toBe(2);

      const res = await runHeldMailboxSweepOnce();
      expect(res.expired).toBe(1);
      expect(stalwartClient.deleteAccount).toHaveBeenCalledTimes(1);
      expect(await MailboxModel.findOne({ localPart: 'stale' })).toBeNull();
      expect(await MailboxModel.findOne({ localPart: 'fresh' })).not.toBeNull();
      expect((await TenantModel.findById(tenantId))!.mailboxCount).toBe(1);
    });

    it('never touches activated mailboxes, however old', async () => {
      await TenantModel.updateOne({ _id: tenantId }, { trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 60 * DAY), stripeSubscriptionId: `sub_trial_${tenantId}` });
      await create('live');
      await MailboxModel.collection.updateOne({ localPart: 'live' }, { $set: { createdAt: new Date(Date.now() - 90 * DAY) } });

      expect(await runHeldMailboxSweepOnce()).toEqual({ warned: 0, expired: 0 });
      expect(await MailboxModel.findOne({ localPart: 'live' })).not.toBeNull();
    });
  });
});
