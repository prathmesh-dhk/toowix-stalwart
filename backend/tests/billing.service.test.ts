import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { TenantModel, DomainModel, PlanModel, DomainSubscriptionModel, MailboxModel } from '../src/db/models';
import { stalwartClient } from '../src/stalwart/client';
import { emailService } from '../src/services/email.service';

vi.mock('../src/stripe/client', () => ({
  stripeClient: {
    getOrCreateCustomer: vi.fn(),
    getOrCreatePrice: vi.fn(),
    createCheckoutSession: vi.fn(),
    retrieveSubscription: vi.fn(),
    updateSubscriptionItemPrice: vi.fn(),
    scheduleDowngrade: vi.fn(),
    cancelAtPeriodEnd: vi.fn(),
    reportMeteredUsage: vi.fn(),
    listInvoices: vi.fn(),
    createSetupIntent: vi.fn(),
    addSubscriptionItem: vi.fn(),
    removeSubscriptionItem: vi.fn(),
  },
  meterEventNameForPlan: (plan: any) => `mailbox_count_${plan._id.toString()}`,
}));

import { stripeClient } from '../src/stripe/client';
import { config } from '../src/config';
import { seedPlatformIdentityDomain } from '../src/db/seed';
import {
  startCheckout,
  handleWebhookEvent,
  suspendDomainForNonPayment,
  reactivateDomainForPayment,
  reportMeteredUsage,
  requestUpgrade,
  requestDowngrade,
  cancelSubscription,
  getTenantBillingSummary,
  startSharedDomainCheckout,
  getSharedDomainBillingStatus,
  cancelSharedDomainSubscription,
  BillingError,
} from '../src/services/billing.service';

let mongoServer: MongoMemoryServer;

describe('billing.service', () => {
  let tenantId: string;
  let fixedPlanId: string;
  let meteredPlanId: string;
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
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await PlanModel.deleteMany({});
    await DomainSubscriptionModel.deleteMany({});
    await MailboxModel.deleteMany({});

    const tenant = await TenantModel.create({
      name: 'Acme Co',
      contactEmail: 'admin@acme.test',
      status: 'active',
      mailboxLimit: 50,
      mailboxCount: 0,
    });
    tenantId = tenant._id.toString();

    const fixedPlan = await PlanModel.create({
      name: 'Team',
      seatCount: 10,
      displayOrder: 1,
      isActive: true,
      billingMode: 'fixed',
      monthlyPriceInPaise: 100000,
    });
    fixedPlanId = fixedPlan._id.toString();

    const meteredPlan = await PlanModel.create({
      name: 'Custom',
      seatCount: 99999,
      displayOrder: 2,
      isActive: true,
      billingMode: 'metered',
      monthlyPriceInPaise: 15000,
    });
    meteredPlanId = meteredPlan._id.toString();

    vi.mocked(stripeClient.getOrCreateCustomer).mockResolvedValue('cus_test123');
    vi.mocked(stripeClient.getOrCreatePrice).mockResolvedValue('price_test123');
    vi.spyOn(stalwartClient, 'updateDomainStatus').mockResolvedValue();
    vi.spyOn(stalwartClient, 'updateAccountStatus').mockResolvedValue();
    vi.spyOn(emailService, 'sendBillingGraceStartedEmail').mockResolvedValue({ success: true });
  });

  describe('startCheckout', () => {
    it('creates a Stripe Customer + Price + Checkout Session and returns the redirect URL', async () => {
      const domain = await DomainModel.create({
        tenantId,
        domainName: 'acme.com',
        planId: fixedPlanId,
        planName: 'Team',
        status: 'active',
        isPrimary: true,
      });

      vi.mocked(stripeClient.createCheckoutSession).mockResolvedValue({ url: 'https://checkout.stripe.com/test' } as any);

      const result = await startCheckout(domain._id.toString(), tenantId, actor);

      expect(result.url).toBe('https://checkout.stripe.com/test');
      expect(stripeClient.getOrCreateCustomer).toHaveBeenCalled();
      expect(stripeClient.getOrCreatePrice).toHaveBeenCalled();
      expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_test123', priceId: 'price_test123', quantity: 10 })
      );
    });

    it('rejects a domain with no plan selected', async () => {
      const domain = await DomainModel.create({
        tenantId,
        domainName: 'noplan.com',
        status: 'active',
        isPrimary: true,
      });

      await expect(startCheckout(domain._id.toString(), tenantId, actor)).rejects.toThrow(BillingError);
    });

    it('rejects starting a second checkout when a non-canceled subscription already exists', async () => {
      const domain = await DomainModel.create({
        tenantId,
        domainName: 'already.com',
        planId: fixedPlanId,
        status: 'active',
        isPrimary: true,
      });
      await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_existing',
        stripeSubscriptionItemId: 'si_existing',
        status: 'active',
      });

      await expect(startCheckout(domain._id.toString(), tenantId, actor)).rejects.toMatchObject({
        code: 'SUBSCRIPTION_EXISTS',
      });
    });

    it('attaches a second domain to the tenant\'s existing subscription instead of starting a new Checkout', async () => {
      const domain1 = await DomainModel.create({
        tenantId,
        domainName: 'first.com',
        planId: fixedPlanId,
        status: 'active',
        isPrimary: true,
      });
      await DomainSubscriptionModel.create({
        domainId: domain1._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_shared',
        stripeSubscriptionItemId: 'si_first',
        status: 'trialing',
        currentPeriodEnd: new Date('2026-10-01'),
        trialEnd: new Date('2026-10-01'),
      });

      const domain2 = await DomainModel.create({
        tenantId,
        domainName: 'second.com',
        planId: fixedPlanId,
        status: 'active',
        isPrimary: false,
      });

      vi.mocked(stripeClient.addSubscriptionItem).mockResolvedValue({ id: 'si_second' } as any);

      const result = await startCheckout(domain2._id.toString(), tenantId, actor);

      expect(result).toEqual({ attached: true });
      expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
      expect(stripeClient.addSubscriptionItem).toHaveBeenCalledWith('sub_shared', 'price_test123', 10);

      const sub2 = await DomainSubscriptionModel.findOne({ domainId: domain2._id });
      expect(sub2?.stripeSubscriptionId).toBe('sub_shared');
      expect(sub2?.stripeSubscriptionItemId).toBe('si_second');
      // Rides the remainder of the existing (still-trialing) shared subscription.
      expect(sub2?.status).toBe('trialing');
      expect(sub2?.trialEnd?.toISOString()).toBe(new Date('2026-10-01').toISOString());
    });
  });

  describe('handleWebhookEvent', () => {
    it('checkout.session.completed creates a trialing DomainSubscription', async () => {
      const domain = await DomainModel.create({
        tenantId,
        domainName: 'newsub.com',
        planId: fixedPlanId,
        status: 'active',
        isPrimary: true,
      });

      vi.mocked(stripeClient.retrieveSubscription).mockResolvedValue({
        id: 'sub_1',
        status: 'trialing',
        cancel_at_period_end: false,
        trial_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        items: { data: [{ id: 'si_1', current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] },
      } as any);

      await handleWebhookEvent({
        type: 'checkout.session.completed',
        data: {
          object: {
            subscription: 'sub_1',
            metadata: { domainId: domain._id.toString(), tenantId, planId: fixedPlanId },
          },
        },
      } as any);

      const sub = await DomainSubscriptionModel.findOne({ domainId: domain._id });
      expect(sub?.status).toBe('trialing');
      expect(sub?.stripeSubscriptionId).toBe('sub_1');
      expect(sub?.stripeSubscriptionItemId).toBe('si_1');
    });

    it('invoice.payment_failed sets grace status + gracePeriodEndsAt ~7 days out and sends the warning email', async () => {
      const domain = await DomainModel.create({
        tenantId,
        domainName: 'failing.com',
        planId: fixedPlanId,
        status: 'active',
        isPrimary: true,
      });
      const sub = await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_fail',
        stripeSubscriptionItemId: 'si_fail',
        status: 'active',
      });

      await handleWebhookEvent({
        type: 'invoice.payment_failed',
        data: { object: { subscription: 'sub_fail' } },
      } as any);

      const updated = await DomainSubscriptionModel.findById(sub._id);
      expect(updated?.status).toBe('grace');
      expect(updated?.gracePeriodEndsAt).toBeTruthy();
      const daysOut = (updated!.gracePeriodEndsAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(daysOut).toBeGreaterThan(6.9);
      expect(daysOut).toBeLessThan(7.1);
      expect(emailService.sendBillingGraceStartedEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'admin@acme.test', domainName: 'failing.com' })
      );
    });

    it('invoice.payment_succeeded restores active status, clears grace, and reactivates a suspended domain', async () => {
      const domain = await DomainModel.create({
        tenantId,
        domainName: 'recovering.com',
        planId: fixedPlanId,
        stalwartDomainId: 'stalwart-dom-recover',
        status: 'suspended',
        isPrimary: true,
      });
      const sub = await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_recover',
        stripeSubscriptionItemId: 'si_recover',
        status: 'suspended',
        gracePeriodEndsAt: new Date(),
      });

      await handleWebhookEvent({
        type: 'invoice.payment_succeeded',
        data: { object: { subscription: 'sub_recover', billing_reason: 'subscription_cycle' } },
      } as any);

      const updated = await DomainSubscriptionModel.findById(sub._id);
      expect(updated?.status).toBe('active');
      expect(updated?.gracePeriodEndsAt).toBeNull();

      const updatedDomain = await DomainModel.findById(domain._id);
      expect(updatedDomain?.status).toBe('active');
      expect(stalwartClient.updateDomainStatus).toHaveBeenCalled();
    });

    it('customer.subscription.deleted marks the subscription canceled', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'canceled.com', planId: fixedPlanId, status: 'active' });
      const sub = await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_del',
        stripeSubscriptionItemId: 'si_del',
        status: 'active',
      });

      await handleWebhookEvent({
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_del' } },
      } as any);

      const updated = await DomainSubscriptionModel.findById(sub._id);
      expect(updated?.status).toBe('canceled');
    });
  });

  describe('suspendDomainForNonPayment / reactivateDomainForPayment', () => {
    it('suspends the domain and cascades to its mailboxes without touching other domains', async () => {
      const domain = await DomainModel.create({
        tenantId,
        domainName: 'suspend-me.com',
        stalwartDomainId: 'stalwart-dom-1',
        status: 'active',
      });
      const otherDomain = await DomainModel.create({ tenantId, domainName: 'unaffected.com', status: 'active' });

      const mailbox = await MailboxModel.create({
        tenantId,
        domainId: domain._id,
        localPart: 'alice',
        address: 'alice@suspend-me.com',
        stalwartAccountId: 'acc-1',
        status: 'active',
      });

      await suspendDomainForNonPayment(domain._id.toString(), tenantId);

      expect((await DomainModel.findById(domain._id))?.status).toBe('suspended');
      expect((await DomainModel.findById(otherDomain._id))?.status).toBe('active');
      expect((await MailboxModel.findById(mailbox._id))?.status).toBe('suspended');
      expect(stalwartClient.updateDomainStatus).toHaveBeenCalledWith('stalwart-dom-1', false);

      await reactivateDomainForPayment(domain._id.toString(), tenantId);
      expect((await DomainModel.findById(domain._id))?.status).toBe('active');
      expect((await MailboxModel.findById(mailbox._id))?.status).toBe('active');
    });

    it('on the shared platform domain, only touches the paying tenant, never the domain itself or other tenants', async () => {
      const platformTenant = await TenantModel.create({ name: 'Toowix Platform Identities', status: 'active' });
      const otherTenantId = (await TenantModel.create({ name: 'Rival Inc', status: 'active' }))._id.toString();
      const sharedDomain = await DomainModel.create({
        tenantId: platformTenant._id,
        domainName: 'dhkmail.com',
        stalwartDomainId: 'stalwart-shared',
        status: 'active',
      });

      const ourMailbox = await MailboxModel.create({
        tenantId: platformTenant._id,
        ownerTenantId: tenantId,
        domainId: sharedDomain._id,
        localPart: 'sales',
        address: 'sales@dhkmail.com',
        status: 'active',
      });
      const theirMailbox = await MailboxModel.create({
        tenantId: platformTenant._id,
        ownerTenantId: otherTenantId,
        domainId: sharedDomain._id,
        localPart: 'support',
        address: 'support@dhkmail.com',
        status: 'active',
      });

      await suspendDomainForNonPayment(sharedDomain._id.toString(), tenantId);

      // Only our mailbox is suspended; the other tenant's mailbox and the shared Domain itself
      // (used by every tenant) are left completely alone.
      expect((await MailboxModel.findById(ourMailbox._id))?.status).toBe('suspended');
      expect((await MailboxModel.findById(theirMailbox._id))?.status).toBe('active');
      expect((await DomainModel.findById(sharedDomain._id))?.status).toBe('active');
      expect(stalwartClient.updateDomainStatus).not.toHaveBeenCalled();

      await reactivateDomainForPayment(sharedDomain._id.toString(), tenantId);
      expect((await MailboxModel.findById(ourMailbox._id))?.status).toBe('active');
    });
  });

  describe('reportMeteredUsage', () => {
    it('tracks the running peak and reports it to Stripe, never lowering on delete', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'metered.com', planId: meteredPlanId, status: 'active' });
      const sub = await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: meteredPlanId,
        stripeSubscriptionId: 'sub_metered',
        stripeSubscriptionItemId: 'si_metered',
        status: 'active',
      });
      await TenantModel.updateOne({ _id: tenantId }, { stripeCustomerId: 'cus_test123' });

      await MailboxModel.create({ tenantId, domainId: domain._id, localPart: 'a', address: 'a@metered.com', status: 'active' });
      await MailboxModel.create({ tenantId, domainId: domain._id, localPart: 'b', address: 'b@metered.com', status: 'active' });

      await reportMeteredUsage(domain._id.toString());
      expect((await DomainSubscriptionModel.findById(sub._id))?.peakMailboxCountThisPeriod).toBe(2);
      expect(stripeClient.reportMeteredUsage).toHaveBeenLastCalledWith(expect.any(String), 'cus_test123', 2);

      // Deleting one mailbox must NOT lower the reported peak.
      await MailboxModel.deleteOne({ localPart: 'a', domainId: domain._id });
      await reportMeteredUsage(domain._id.toString());
      expect((await DomainSubscriptionModel.findById(sub._id))?.peakMailboxCountThisPeriod).toBe(2);
    });

    it('no-ops for a fixed-tier plan', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'fixed.com', planId: fixedPlanId, status: 'active' });
      await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_fixed',
        stripeSubscriptionItemId: 'si_fixed',
        status: 'active',
      });

      await reportMeteredUsage(domain._id.toString());
      expect(stripeClient.reportMeteredUsage).not.toHaveBeenCalled();
    });
  });

  describe('upgrade / downgrade / cancel', () => {
    it('requestUpgrade updates the subscription item price immediately and syncs Domain.mailboxLimit', async () => {
      const domain = await DomainModel.create({
        tenantId,
        domainName: 'upgrade.com',
        planId: fixedPlanId,
        mailboxLimit: 10,
        status: 'active',
      });
      await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_up',
        stripeSubscriptionItemId: 'si_up',
        status: 'active',
      });

      const biggerPlan = await PlanModel.create({ name: 'Growth', seatCount: 25, displayOrder: 3, isActive: true, monthlyPriceInPaise: 200000 });
      vi.mocked(stripeClient.getOrCreatePrice).mockResolvedValue('price_bigger');

      await requestUpgrade(domain._id.toString(), tenantId, biggerPlan._id.toString(), actor);

      expect(stripeClient.updateSubscriptionItemPrice).toHaveBeenCalledWith('sub_up', 'si_up', 'price_bigger', 25);
      expect((await DomainModel.findById(domain._id))?.mailboxLimit).toBe(25);
    });

    it('requestDowngrade schedules the change without touching Domain.mailboxLimit yet', async () => {
      const domain = await DomainModel.create({
        tenantId,
        domainName: 'downgrade.com',
        planId: fixedPlanId,
        mailboxLimit: 10,
        status: 'active',
      });
      const sub = await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_down',
        stripeSubscriptionItemId: 'si_down',
        status: 'active',
      });

      const smallerPlan = await PlanModel.create({ name: 'Individual', seatCount: 1, displayOrder: 0, isActive: true });
      vi.mocked(stripeClient.getOrCreatePrice).mockResolvedValue('price_smaller');

      await requestDowngrade(domain._id.toString(), tenantId, smallerPlan._id.toString(), actor);

      expect(stripeClient.scheduleDowngrade).toHaveBeenCalledWith('sub_down', 'price_smaller', 1);
      expect((await DomainModel.findById(domain._id))?.mailboxLimit).toBe(10); // unchanged until renewal
      expect((await DomainSubscriptionModel.findById(sub._id))?.pendingDowngradePlanId?.toString()).toBe(smallerPlan._id.toString());
    });

    it('cancelSubscription sets cancel_at_period_end on Stripe when this is the last domain on the subscription', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'cancel.com', planId: fixedPlanId, status: 'active' });
      const sub = await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_cancel',
        stripeSubscriptionItemId: 'si_cancel',
        status: 'active',
      });

      await cancelSubscription(domain._id.toString(), tenantId, actor);

      expect(stripeClient.cancelAtPeriodEnd).toHaveBeenCalledWith('sub_cancel', true);
      expect(stripeClient.removeSubscriptionItem).not.toHaveBeenCalled();
      expect((await DomainSubscriptionModel.findById(sub._id))?.cancelAtPeriodEnd).toBe(true);
    });

    it('cancelSubscription only detaches this domain\'s item when siblings remain on the shared subscription', async () => {
      const domain1 = await DomainModel.create({ tenantId, domainName: 'keep.com', planId: fixedPlanId, status: 'active' });
      await DomainSubscriptionModel.create({
        domainId: domain1._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_multi',
        stripeSubscriptionItemId: 'si_keep',
        status: 'active',
      });
      const domain2 = await DomainModel.create({ tenantId, domainName: 'remove.com', planId: fixedPlanId, status: 'active' });
      const sub2 = await DomainSubscriptionModel.create({
        domainId: domain2._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_multi',
        stripeSubscriptionItemId: 'si_remove',
        status: 'active',
      });

      await cancelSubscription(domain2._id.toString(), tenantId, actor);

      expect(stripeClient.removeSubscriptionItem).toHaveBeenCalledWith('si_remove');
      expect(stripeClient.cancelAtPeriodEnd).not.toHaveBeenCalled();
      expect((await DomainSubscriptionModel.findById(sub2._id))?.status).toBe('canceled');
      // The other domain on the shared subscription is completely unaffected.
      const sibling = await DomainSubscriptionModel.findOne({ domainId: domain1._id });
      expect(sibling?.status).toBe('active');
    });
  });

  describe('combined-billing webhook cascade', () => {
    it('invoice.payment_failed puts every sibling domain on the shared subscription into grace', async () => {
      const domain1 = await DomainModel.create({ tenantId, domainName: 'sibling1.com', planId: fixedPlanId, status: 'active' });
      const domain2 = await DomainModel.create({ tenantId, domainName: 'sibling2.com', planId: fixedPlanId, status: 'active' });
      const sub1 = await DomainSubscriptionModel.create({
        domainId: domain1._id, tenantId, planId: fixedPlanId,
        stripeSubscriptionId: 'sub_shared_fail', stripeSubscriptionItemId: 'si_s1', status: 'active',
      });
      const sub2 = await DomainSubscriptionModel.create({
        domainId: domain2._id, tenantId, planId: fixedPlanId,
        stripeSubscriptionId: 'sub_shared_fail', stripeSubscriptionItemId: 'si_s2', status: 'active',
      });

      await handleWebhookEvent({
        type: 'invoice.payment_failed',
        data: { object: { subscription: 'sub_shared_fail' } },
      } as any);

      expect((await DomainSubscriptionModel.findById(sub1._id))?.status).toBe('grace');
      expect((await DomainSubscriptionModel.findById(sub2._id))?.status).toBe('grace');
      expect(emailService.sendBillingGraceStartedEmail).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTenantBillingSummary', () => {
    it('returns no subscription for a tenant with nothing billed yet', async () => {
      const summary = await getTenantBillingSummary(tenantId);
      expect(summary.hasSubscription).toBe(false);
      expect(summary.domains).toEqual([]);
    });

    it('lists every domain sharing the tenant\'s subscription', async () => {
      const domain1 = await DomainModel.create({ tenantId, domainName: 'sum1.com', planId: fixedPlanId, status: 'active' });
      const domain2 = await DomainModel.create({ tenantId, domainName: 'sum2.com', planId: fixedPlanId, status: 'active' });
      await DomainSubscriptionModel.create({
        domainId: domain1._id, tenantId, planId: fixedPlanId,
        stripeSubscriptionId: 'sub_sum', stripeSubscriptionItemId: 'si_sum1', status: 'active',
        currentPeriodEnd: new Date('2026-11-01'),
      });
      await DomainSubscriptionModel.create({
        domainId: domain2._id, tenantId, planId: fixedPlanId,
        stripeSubscriptionId: 'sub_sum', stripeSubscriptionItemId: 'si_sum2', status: 'active',
      });

      const summary = await getTenantBillingSummary(tenantId);
      expect(summary.hasSubscription).toBe(true);
      expect(summary.status).toBe('active');
      expect(summary.domains).toHaveLength(2);
      expect(summary.domains.map((d) => d.domainName).sort()).toEqual(['sum1.com', 'sum2.com']);
      expect(summary.domains[0].planName).toBe('Team');
    });
  });

  describe('startSharedDomainCheckout / getSharedDomainBillingStatus / cancelSharedDomainSubscription', () => {
    let sharedDomainId: string;

    beforeEach(async () => {
      await seedPlatformIdentityDomain();
      const sharedDomain = await DomainModel.findOne({ domainName: config.platformMailDomain });
      sharedDomainId = sharedDomain!._id.toString();
    });

    it('creates a Stripe Checkout Session for a tenant\'s first dhkmail subscription', async () => {
      vi.mocked(stripeClient.createCheckoutSession).mockResolvedValue({ url: 'https://checkout.stripe.com/dhkmail' } as any);

      const result = await startSharedDomainCheckout(tenantId, fixedPlanId, actor);

      expect(result).toMatchObject({ url: 'https://checkout.stripe.com/dhkmail' });
      expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { domainId: sharedDomainId, tenantId, planId: fixedPlanId } })
      );
    });

    it('attaches to an existing owned-domain subscription instead of starting a new Checkout', async () => {
      const ownedDomain = await DomainModel.create({ tenantId, domainName: 'acme.com', planId: fixedPlanId, status: 'active' });
      await DomainSubscriptionModel.create({
        domainId: ownedDomain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_existing',
        stripeSubscriptionItemId: 'si_existing',
        status: 'active',
      });
      vi.mocked(stripeClient.addSubscriptionItem).mockResolvedValue({ id: 'si_dhkmail' } as any);

      const result = await startSharedDomainCheckout(tenantId, fixedPlanId, actor);

      expect(result).toEqual({ attached: true });
      expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
      const sub = await DomainSubscriptionModel.findOne({ domainId: sharedDomainId, tenantId });
      expect(sub).toMatchObject({ stripeSubscriptionId: 'sub_existing', stripeSubscriptionItemId: 'si_dhkmail', mailboxLimit: 10 });
    });

    it('rejects starting a second dhkmail checkout when this tenant already has an active one', async () => {
      await DomainSubscriptionModel.create({
        domainId: sharedDomainId,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_dhkmail',
        stripeSubscriptionItemId: 'si_dhkmail',
        status: 'active',
      });

      await expect(startSharedDomainCheckout(tenantId, fixedPlanId, actor)).rejects.toMatchObject({
        code: 'SUBSCRIPTION_EXISTS',
      });
    });

    it('a second tenant subscribing to dhkmail does not collide with the first tenant\'s row', async () => {
      const otherTenantId = (await TenantModel.create({ name: 'Rival Inc', status: 'active' }))._id.toString();
      vi.mocked(stripeClient.createCheckoutSession).mockResolvedValue({ url: 'https://checkout.stripe.com/a' } as any);
      await startSharedDomainCheckout(tenantId, fixedPlanId, actor);

      vi.mocked(stripeClient.createCheckoutSession).mockResolvedValue({ url: 'https://checkout.stripe.com/b' } as any);
      const result = await startSharedDomainCheckout(otherTenantId, fixedPlanId, { ...actor, id: 'admin-2' });
      expect(result).toMatchObject({ url: 'https://checkout.stripe.com/b' });
      expect(await DomainSubscriptionModel.countDocuments({ domainId: sharedDomainId })).toBe(0); // neither reached checkout.session.completed yet
    });

    it('getSharedDomainBillingStatus returns this tenant\'s own row, not another tenant\'s', async () => {
      const otherTenantId = (await TenantModel.create({ name: 'Rival Inc', status: 'active' }))._id.toString();
      await DomainSubscriptionModel.create({
        domainId: sharedDomainId,
        tenantId: otherTenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_other',
        stripeSubscriptionItemId: 'si_other',
        status: 'active',
      });

      const status = await getSharedDomainBillingStatus(tenantId);
      expect(status.subscription).toBeNull();

      const otherStatus = await getSharedDomainBillingStatus(otherTenantId);
      expect(otherStatus.subscription).toMatchObject({ stripeSubscriptionId: 'sub_other' });
    });

    it('cancelSharedDomainSubscription cancels only this tenant\'s row', async () => {
      const otherTenantId = (await TenantModel.create({ name: 'Rival Inc', status: 'active' }))._id.toString();
      await DomainSubscriptionModel.create({
        domainId: sharedDomainId,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_mine',
        stripeSubscriptionItemId: 'si_mine',
        status: 'active',
      });
      await DomainSubscriptionModel.create({
        domainId: sharedDomainId,
        tenantId: otherTenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_theirs',
        stripeSubscriptionItemId: 'si_theirs',
        status: 'active',
      });

      await cancelSharedDomainSubscription(tenantId, actor);

      // Dhkmail is the only item on this tenant's own Stripe subscription, so cancellation is
      // scheduled for period end (Stripe's own webhook flips status to 'canceled' once it lands).
      const mine = await DomainSubscriptionModel.findOne({ domainId: sharedDomainId, tenantId });
      expect(mine!.cancelAtPeriodEnd).toBe(true);
      expect(stripeClient.cancelAtPeriodEnd).toHaveBeenCalledWith('sub_mine', true);
      const theirs = await DomainSubscriptionModel.findOne({ domainId: sharedDomainId, tenantId: otherTenantId });
      expect(theirs!.status).toBe('active');
      expect(theirs!.cancelAtPeriodEnd).toBe(false);
    });

    it('cancelling one of two items on the same tenant subscription only detaches that item', async () => {
      const ownedDomain = await DomainModel.create({ tenantId, domainName: 'acme.com', planId: fixedPlanId, status: 'active' });
      await DomainSubscriptionModel.create({
        domainId: ownedDomain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_combined',
        stripeSubscriptionItemId: 'si_owned',
        status: 'active',
      });
      await DomainSubscriptionModel.create({
        domainId: sharedDomainId,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_combined',
        stripeSubscriptionItemId: 'si_dhkmail',
        status: 'active',
      });

      await cancelSharedDomainSubscription(tenantId, actor);

      expect(stripeClient.removeSubscriptionItem).toHaveBeenCalledWith('si_dhkmail');
      const dhkmailSub = await DomainSubscriptionModel.findOne({ domainId: sharedDomainId, tenantId });
      expect(dhkmailSub!.status).toBe('canceled');
      // The owned domain's item on the same combined subscription is untouched.
      const ownedSub = await DomainSubscriptionModel.findOne({ domainId: ownedDomain._id, tenantId });
      expect(ownedSub!.status).toBe('active');
    });

    it('rejects cancelling when this tenant has no dhkmail subscription', async () => {
      await expect(cancelSharedDomainSubscription(tenantId, actor)).rejects.toMatchObject({ code: 'NO_SUBSCRIPTION' });
    });
  });
});
