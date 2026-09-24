import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { TenantModel, DomainModel, PlanModel, DomainSubscriptionModel, MailboxModel, StripeEventModel } from '../src/db/models';
import { stalwartClient } from '../src/stalwart/client';
import { emailService } from '../src/services/email.service';
import { config } from '../src/config';

vi.mock('../src/stripe/client', () => ({
  stripeClient: {
    getOrCreateCustomer: vi.fn(),
    getOrCreatePrice: vi.fn(),
    retrieveCheckoutSession: vi.fn(),
    retrieveSubscriptionExpanded: vi.fn(),
    addSubscriptionItem: vi.fn(),
    addDomainSubscriptionItem: vi.fn(),
    syncDomainUserQuantity: vi.fn(),
    retrieveSubscription: vi.fn(),
    listInvoices: vi.fn(),
    createDedicatedMeteredPrice: vi.fn(),
  },
  meterEventNameForPlan: (plan: any) => `mailbox_count_${plan._id.toString()}`,
}));

import { stripeClient } from '../src/stripe/client';
import {
  handleWebhookEvent,
  attachDomainWithSavedPayment,
  completeCartCheckout,
  startCartCheckout,
  subscriptionIdOf,
} from '../src/services/billing.service';

let mongoServer: MongoMemoryServer;

describe('billing hardening (phase 0)', () => {
  let tenantId: string;
  let planId: string;
  const actor = { id: 'admin-1', email: 'admin@acme.test', role: 'TENANT_ADMIN' };

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
    await Promise.all([TenantModel, DomainModel, PlanModel, DomainSubscriptionModel, MailboxModel, StripeEventModel].map((m) => m.deleteMany({})));
    const tenant = await TenantModel.create({ name: 'Acme', contactEmail: 'admin@acme.test', status: 'active', mailboxLimit: 50, mailboxCount: 0 });
    tenantId = tenant._id.toString();
    planId = (await PlanModel.create({ name: 'Team', seatCount: 10, displayOrder: 1, isActive: true, billingMode: 'fixed', monthlyPriceInPaise: 10000 }))._id.toString();

    vi.mocked(stripeClient.getOrCreateCustomer).mockResolvedValue('cus_1');
    vi.mocked(stripeClient.getOrCreatePrice).mockResolvedValue('price_1');
    vi.mocked(stripeClient.addDomainSubscriptionItem).mockResolvedValue({ id: 'si_added' } as any);
    vi.mocked(stripeClient.retrieveCheckoutSession).mockResolvedValue({
      id: 'cs_1', status: 'complete', subscription: 'sub_master', metadata: { tenantId, purpose: 'cart_activation' },
    } as any);
    vi.mocked(stripeClient.retrieveSubscriptionExpanded).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30)); // widen the race window
      return { id: 'sub_master', trial_start: 1, trial_end: Math.floor(Date.now() / 1000) + 86400, default_payment_method: null, items: { data: [] } } as any;
    });
    vi.spyOn(stalwartClient, 'updateDomainStatus').mockResolvedValue();
    vi.spyOn(stalwartClient, 'updateAccountStatus').mockResolvedValue();
    vi.spyOn(emailService, 'sendBillingGraceStartedEmail').mockResolvedValue({ success: true });
  });

  afterEach(() => {
    (config as any).nodeEnv = 'test';
    delete process.env.SKIP_BILLING;
  });

  describe('webhook idempotency', () => {
    it('handles a redelivered event exactly once', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'a.com', planId, status: 'active', isPrimary: true });
      await DomainSubscriptionModel.create({
        domainId: domain._id, tenantId, planId, stripeSubscriptionId: 'sub_x', stripeSubscriptionItemId: 'si_x', status: 'active',
      });
      const event = { id: 'evt_1', type: 'invoice.payment_failed', data: { object: { subscription: 'sub_x' } } } as any;

      await handleWebhookEvent(event);
      await handleWebhookEvent(event);

      expect(emailService.sendBillingGraceStartedEmail).toHaveBeenCalledTimes(1);
      expect(await StripeEventModel.countDocuments({ eventId: 'evt_1' })).toBe(1);
    });

    it('releases the event id when the handler throws so Stripe\'s retry runs again', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'b.com', planId, status: 'active', isPrimary: true });
      await DomainSubscriptionModel.create({
        domainId: domain._id, tenantId, planId, stripeSubscriptionId: 'sub_y', stripeSubscriptionItemId: 'si_y', status: 'active',
      });
      vi.spyOn(emailService, 'sendBillingGraceStartedEmail').mockRejectedValueOnce(new Error('smtp down'));
      const event = { id: 'evt_2', type: 'invoice.payment_failed', data: { object: { subscription: 'sub_y' } } } as any;

      await expect(handleWebhookEvent(event)).rejects.toThrow('smtp down');
      expect(await StripeEventModel.countDocuments({ eventId: 'evt_2' })).toBe(0);

      await handleWebhookEvent(event);
      expect((await DomainSubscriptionModel.findOne({ stripeSubscriptionId: 'sub_y' }))?.status).toBe('grace');
    });
  });

  describe('Stripe API version compatibility', () => {
    it('reads the subscription id from invoice.parent.subscription_details (2025+ API) and the legacy field', () => {
      expect(subscriptionIdOf({ parent: { subscription_details: { subscription: 'sub_new' } } } as any)).toBe('sub_new');
      expect(subscriptionIdOf({ subscription: 'sub_old' } as any)).toBe('sub_old');
      expect(subscriptionIdOf({} as any)).toBeUndefined();
    });

    it('a payment_failed invoice in the new shape still puts the domain into grace', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'c.com', planId, status: 'active', isPrimary: true });
      await DomainSubscriptionModel.create({
        domainId: domain._id, tenantId, planId, stripeSubscriptionId: 'sub_new', stripeSubscriptionItemId: 'si_new', status: 'active',
      });
      await handleWebhookEvent({
        id: 'evt_3', type: 'invoice.payment_failed',
        data: { object: { parent: { subscription_details: { subscription: 'sub_new' } } } },
      } as any);
      expect((await DomainSubscriptionModel.findOne({ stripeSubscriptionId: 'sub_new' }))?.status).toBe('grace');
    });

    it('customer.subscription.updated updates EVERY domain item, not just the first', async () => {
      const d1 = await DomainModel.create({ tenantId, domainName: 'one.com', planId, status: 'active', isPrimary: true });
      const d2 = await DomainModel.create({ tenantId, domainName: 'two.com', planId, status: 'active' });
      for (const [d, item] of [[d1, 'si_a'], [d2, 'si_b']] as const) {
        await DomainSubscriptionModel.create({
          domainId: d._id, tenantId, planId, stripeSubscriptionId: 'sub_multi', stripeSubscriptionItemId: item, status: 'trialing',
        });
      }
      await handleWebhookEvent({
        id: 'evt_4', type: 'customer.subscription.updated',
        data: { object: { id: 'sub_multi', status: 'active', cancel_at_period_end: true, items: { data: [
          { id: 'si_a', current_period_end: 1800000000 },
          { id: 'si_b', current_period_end: 1900000000 },
        ] } } },
      } as any);

      const a = await DomainSubscriptionModel.findOne({ stripeSubscriptionItemId: 'si_a' });
      const b = await DomainSubscriptionModel.findOne({ stripeSubscriptionItemId: 'si_b' });
      expect(a?.status).toBe('active');
      expect(a?.cancelAtPeriodEnd).toBe(true);
      expect(a?.currentPeriodEnd?.getTime()).toBe(1800000000 * 1000);
      expect(b?.currentPeriodEnd?.getTime()).toBe(1900000000 * 1000);
    });
  });

  describe('atomic activation', () => {
    it('two simultaneous return trips adopt the Stripe subscription exactly once', async () => {
      await DomainModel.create({ tenantId, domainName: 'race.com', planId, status: 'active', isPrimary: true });

      const results = await Promise.allSettled([
        completeCartCheckout(tenantId, 'cs_1', actor),
        completeCartCheckout(tenantId, 'cs_1', actor),
      ]);

      expect(stripeClient.retrieveSubscriptionExpanded).toHaveBeenCalledTimes(1);
      const tenant = await TenantModel.findById(tenantId);
      expect(tenant?.trialStartedAt).toBeTruthy();
      expect(tenant?.stripeSubscriptionId).toBe('sub_master');
      expect(tenant?.activationLock).toBeNull();
      // The loser either saw the finished trial or was told to retry — never a 500.
      for (const r of results) {
        if (r.status === 'rejected') expect((r.reason as any).code).toBe('ACTIVATION_IN_PROGRESS');
      }
    });

    it('a stale lock (older than 5 minutes) does not block activation', async () => {
      await DomainModel.create({ tenantId, domainName: 'stale.com', planId, status: 'active', isPrimary: true });
      await TenantModel.updateOne({ _id: tenantId }, { activationLock: new Date(Date.now() - 10 * 60 * 1000) });
      await completeCartCheckout(tenantId, 'cs_1', actor);
      expect((await TenantModel.findById(tenantId))?.trialStartedAt).toBeTruthy();
    });

    it('a fresh lock held by another activation gives a retryable 409', async () => {
      await DomainModel.create({ tenantId, domainName: 'busy.com', planId, status: 'active', isPrimary: true });
      await TenantModel.updateOne({ _id: tenantId }, { activationLock: new Date() });
      await expect(completeCartCheckout(tenantId, 'cs_1', actor)).rejects.toMatchObject({ code: 'ACTIVATION_IN_PROGRESS', statusCode: 409 });
    });
  });

  describe('production fails closed', () => {
    it('refuses to activate or start checkout when Stripe is not configured in production', async () => {
      process.env.SKIP_BILLING = 'true';
      (config as any).nodeEnv = 'production';
      const domain = await DomainModel.create({ tenantId, domainName: 'prod.com', planId, status: 'active', isPrimary: true });

      await expect(attachDomainWithSavedPayment(domain._id.toString(), tenantId, actor)).rejects.toMatchObject({ code: 'BILLING_NOT_CONFIGURED', statusCode: 503 });
      await expect(completeCartCheckout(tenantId, 'cs_1', actor)).rejects.toMatchObject({ code: 'BILLING_NOT_CONFIGURED', statusCode: 503 });
      await expect(startCartCheckout(tenantId, actor)).rejects.toMatchObject({ code: 'BILLING_NOT_CONFIGURED', statusCode: 503 });
      expect((await TenantModel.findById(tenantId))?.trialStartedAt).toBeNull();
    });

    it('outside production the sandbox path still works without Stripe', async () => {
      process.env.SKIP_BILLING = 'true';
      const res = await startCartCheckout(tenantId, actor);
      expect(res).toEqual({ sandbox: true });
    });
  });
});
