import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { TenantModel, DomainModel, PlanModel, DomainSubscriptionModel, MailboxModel } from '../src/db/models';
import { stalwartClient } from '../src/stalwart/client';
import { emailService } from '../src/services/email.service';

vi.mock('../src/stripe/client', () => ({
  stripeClient: {
    getOrCreateCustomer: vi.fn(),
    retrieveSubscription: vi.fn(),
    updateSubscriptionItemPrice: vi.fn(),
    setPendingPrices: vi.fn(),
    cancelAtPeriodEnd: vi.fn(),
    reportMeteredUsage: vi.fn(),
    listInvoices: vi.fn(),
    createSetupIntent: vi.fn(),
    removeSubscriptionItem: vi.fn(),
    createDomainPrice: vi.fn(),
    retrieveSubscriptionExpanded: vi.fn(),
  },
  meterEventNameForPlan: (plan: any) => `mailbox_count_${plan._id.toString()}`,
}));

import { stripeClient } from '../src/stripe/client';
import {
  handleWebhookEvent,
  suspendDomainForNonPayment,
  reactivateDomainForPayment,
  reportMeteredUsage,
  requestUpgrade,
  requestDowngrade,
  cancelSubscription,
  getTenantBillingSummary,
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
    vi.spyOn(stalwartClient, 'updateDomainStatus').mockResolvedValue();
    vi.spyOn(stalwartClient, 'updateAccountStatus').mockResolvedValue();
    vi.spyOn(emailService, 'sendBillingGraceStartedEmail').mockResolvedValue({ success: true });
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

    it("Stripe's payment retries keep the Grace Period deadline 7 days after the failed invoice (test clock time)", async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'retrying.com', planId: fixedPlanId, status: 'active' });
      const sub = await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_retry',
        stripeSubscriptionItemId: 'si_retry',
        status: 'active',
      });
      // A test clock a month ahead of the wall clock.
      const invoiceCreated = Math.floor(Date.UTC(2030, 0, 1) / 1000);
      const failed = { id: 'in_retry', subscription: 'sub_retry', created: invoiceCreated };

      await handleWebhookEvent({ id: 'evt_fail_1', type: 'invoice.payment_failed', data: { object: failed } } as any);
      await handleWebhookEvent({ id: 'evt_fail_2', type: 'invoice.payment_failed', data: { object: failed } } as any);

      const updated = await DomainSubscriptionModel.findById(sub._id);
      expect(updated?.gracePeriodEndsAt?.toISOString()).toBe('2030-01-08T00:00:00.000Z');
      expect(emailService.sendBillingGraceStartedEmail).toHaveBeenCalledTimes(1);
    });

    it('a payment retry failing after the grace sweep suspended the domain keeps it suspended', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'still-unpaid.com', planId: fixedPlanId, status: 'suspended' });
      const sub = await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_unpaid',
        stripeSubscriptionItemId: 'si_unpaid',
        status: 'suspended',
      });

      await handleWebhookEvent({ type: 'invoice.payment_failed', data: { object: { id: 'in_unpaid', subscription: 'sub_unpaid' } } } as any);

      expect((await DomainSubscriptionModel.findById(sub._id))?.status).toBe('suspended');
      expect(emailService.sendBillingGraceStartedEmail).not.toHaveBeenCalled();
    });

    it("Stripe's past_due subscription update arriving after the failed invoice keeps the Grace Period open", async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'late-update.com', planId: fixedPlanId, status: 'active' });
      const sub = await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_late',
        stripeSubscriptionItemId: 'si_late',
        status: 'active',
      });

      await handleWebhookEvent({ type: 'invoice.payment_failed', data: { object: { id: 'in_late', subscription: 'sub_late' } } } as any);
      await handleWebhookEvent({
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_late', status: 'past_due', cancel_at_period_end: false, items: { data: [] } } },
      } as any);

      expect((await DomainSubscriptionModel.findById(sub._id))?.status).toBe('grace');
    });

    it('follows a domain onto the new item Stripe creates when a scheduled downgrade starts', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'renewed.com', planId: fixedPlanId, status: 'active' });
      const sub = await DomainSubscriptionModel.create({
        domainId: domain._id, tenantId, planId: fixedPlanId,
        stripeSubscriptionId: 'sub_phase', stripeSubscriptionItemId: 'si_before_phase', status: 'active',
      });
      vi.mocked(stripeClient.retrieveSubscriptionExpanded).mockResolvedValue({
        id: 'sub_phase',
        items: { data: [{ id: 'si_after_phase', price: { product: { id: 'prod_x', metadata: { domainId: domain._id.toString() } } } }] },
      } as any);

      const periodEnd = Math.floor(new Date('2027-02-18T00:00:00Z').getTime() / 1000);
      await handleWebhookEvent({
        id: 'evt_phase', type: 'customer.subscription.updated',
        data: { object: { id: 'sub_phase', status: 'active', cancel_at_period_end: false, items: { data: [{ id: 'si_after_phase', current_period_end: periodEnd }] } } },
      } as any);

      const row = await DomainSubscriptionModel.findById(sub._id);
      expect(row?.stripeSubscriptionItemId).toBe('si_after_phase');
      expect(row?.currentPeriodEnd?.toISOString()).toBe('2027-02-18T00:00:00.000Z');
    });

    it('a change made while a downgrade is pending keeps the downgrade in the next phase', async () => {
      const [a, b] = await DomainModel.create([
        { tenantId, domainName: 'pending-a.com', planId: fixedPlanId, status: 'active' },
        { tenantId, domainName: 'joined-b.com', planId: fixedPlanId, status: 'active' },
      ]);
      await DomainSubscriptionModel.create([
        {
          domainId: a._id, tenantId, planId: fixedPlanId, stripeSubscriptionId: 'sub_pending',
          stripeSubscriptionItemId: 'si_a', status: 'active', pendingDowngradePriceId: 'price_a_down',
        },
        { domainId: b._id, tenantId, planId: fixedPlanId, stripeSubscriptionId: 'sub_pending', stripeSubscriptionItemId: 'si_b', status: 'active' },
      ]);
      vi.mocked(stripeClient.setPendingPrices).mockClear();

      // A domain joined the subscription after the downgrade was scheduled.
      await handleWebhookEvent({
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_pending', status: 'active', cancel_at_period_end: false, schedule: 'sched_1', items: { data: [{ id: 'si_a' }, { id: 'si_b' }] } } },
      } as any);

      expect(stripeClient.setPendingPrices).toHaveBeenCalledWith('sub_pending', { si_a: 'price_a_down' });
    });

    it('a subscription update with no schedule and nothing pending does not touch schedules', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'plain.com', planId: fixedPlanId, status: 'active' });
      await DomainSubscriptionModel.create({
        domainId: domain._id, tenantId, planId: fixedPlanId, stripeSubscriptionId: 'sub_plain', stripeSubscriptionItemId: 'si_plain', status: 'active',
      });
      vi.mocked(stripeClient.setPendingPrices).mockClear();

      await handleWebhookEvent({
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_plain', status: 'active', cancel_at_period_end: false, schedule: null, items: { data: [{ id: 'si_plain' }] } } },
      } as any);

      expect(stripeClient.setPendingPrices).not.toHaveBeenCalled();
    });

    it("paying after suspension restores the mailboxes even when Stripe's active update arrives first", async () => {
      const domain = await DomainModel.create({
        tenantId,
        domainName: 'paid-late.com',
        planId: fixedPlanId,
        stalwartDomainId: 'stalwart-dom-late',
        status: 'suspended',
      });
      const mailbox = await MailboxModel.create({
        tenantId,
        domainId: domain._id,
        domainName: 'paid-late.com',
        localPart: 'a',
        address: 'a@paid-late.com',
        status: 'suspended',
      });
      const sub = await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_paid_late',
        stripeSubscriptionItemId: 'si_paid_late',
        status: 'suspended',
        gracePeriodEndsAt: new Date(),
      });

      await handleWebhookEvent({
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_paid_late', status: 'active', cancel_at_period_end: false, items: { data: [] } } },
      } as any);
      await handleWebhookEvent({
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_paid_late', subscription: 'sub_paid_late', billing_reason: 'subscription_cycle' } },
      } as any);

      expect((await DomainSubscriptionModel.findById(sub._id))?.status).toBe('active');
      expect((await DomainModel.findById(domain._id))?.status).toBe('active');
      expect((await MailboxModel.findById(mailbox._id))?.status).toBe('active');
    });

    it('a retried 3-D Secure charge on the same invoice does not ask the Tenant Admin to authenticate again', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: '3ds-retry.com', planId: fixedPlanId, status: 'active' });
      await TenantModel.updateOne({ _id: tenantId }, { stripeSubscriptionId: 'sub_3ds_retry' });
      await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_3ds_retry',
        stripeSubscriptionItemId: 'si_3ds_retry',
        status: 'grace',
      });
      const notice = vi.spyOn(emailService, 'sendBillingNoticeEmail').mockResolvedValue({ success: true });
      const invoice = { id: 'in_3ds_retry', subscription: 'sub_3ds_retry', hosted_invoice_url: 'https://invoice.stripe.com/i/in_3ds_retry' };

      await handleWebhookEvent({ id: 'evt_3ds_1', type: 'invoice.payment_action_required', data: { object: invoice } } as any);
      await handleWebhookEvent({ id: 'evt_3ds_2', type: 'invoice.payment_action_required', data: { object: invoice } } as any);

      expect(notice).toHaveBeenCalledTimes(1);
    });

    it('a ₹0 invoice paid during the trial (coupon extension, checkout) keeps the domain trialing', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'trialing.com', planId: fixedPlanId, status: 'active' });
      const sub = await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_trialing',
        stripeSubscriptionItemId: 'si_trialing',
        status: 'trialing',
      });

      for (const billing_reason of ['subscription_create', 'subscription_update']) {
        await handleWebhookEvent({
          type: 'invoice.payment_succeeded',
          data: { object: { subscription: 'sub_trialing', billing_reason, amount_paid: 0 } },
        } as any);
        expect((await DomainSubscriptionModel.findById(sub._id))?.status).toBe('trialing');
      }

      // The first real invoice at trial end does make it active.
      await handleWebhookEvent({
        type: 'invoice.payment_succeeded',
        data: { object: { subscription: 'sub_trialing', billing_reason: 'subscription_cycle', amount_paid: 4900 } },
      } as any);
      expect((await DomainSubscriptionModel.findById(sub._id))?.status).toBe('active');
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

    it('customer.subscription.deleted suspends every domain on the subscription and their mailboxes', async () => {
      const domains = [];
      for (const name of ['ended1.com', 'ended2.com']) {
        const domain = await DomainModel.create({ tenantId, domainName: name, planId: fixedPlanId, status: 'active', stalwartDomainId: `sd-${name}` });
        await DomainSubscriptionModel.create({
          domainId: domain._id, tenantId, planId: fixedPlanId,
          stripeSubscriptionId: 'sub_ended', stripeSubscriptionItemId: `si-${name}`, status: 'active', cancelAtPeriodEnd: true,
        });
        await MailboxModel.create({ tenantId, domainId: domain._id, localPart: name[5], address: `u@${name}`, status: 'active' });
        domains.push(domain);
      }

      // A row on a domain another tenant owns (the shared platform domain) must not suspend it.
      const otherTenant = await TenantModel.create({ name: 'Platform', status: 'active', mailboxLimit: 1, mailboxCount: 0 });
      const platform = await DomainModel.create({ tenantId: otherTenant._id, domainName: 'platform.test', status: 'active', stalwartDomainId: 'sd-platform' });
      await DomainSubscriptionModel.create({
        domainId: platform._id, tenantId, planId: fixedPlanId,
        stripeSubscriptionId: 'sub_ended', stripeSubscriptionItemId: 'si-platform', status: 'active',
      });

      await handleWebhookEvent({ id: 'evt_sub_ended', type: 'customer.subscription.deleted', data: { object: { id: 'sub_ended' } } } as any);

      for (const domain of domains) {
        expect((await DomainModel.findById(domain._id))?.status).toBe('suspended');
        expect((await MailboxModel.findOne({ domainId: domain._id }))?.status).toBe('suspended');
        expect(stalwartClient.updateDomainStatus).toHaveBeenCalledWith(domain.stalwartDomainId, false);
      }
      expect((await DomainModel.findById(platform._id))?.status).toBe('active');
    });

    it('customer.subscription.deleted leaves a domain cancelled earlier on its own alone', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'left-earlier.com', planId: fixedPlanId, status: 'suspended', stalwartDomainId: 'sd-left' });
      const retentionEndsAt = new Date('2026-11-01T00:00:00Z');
      await DomainSubscriptionModel.create({
        domainId: domain._id, tenantId, planId: fixedPlanId,
        stripeSubscriptionId: 'sub_ended2', stripeSubscriptionItemId: 'si-left', status: 'canceled', retentionEndsAt,
      });

      await handleWebhookEvent({ id: 'evt_sub_ended2', type: 'customer.subscription.deleted', data: { object: { id: 'sub_ended2' } } } as any);

      expect(stalwartClient.updateDomainStatus).not.toHaveBeenCalled();
      expect((await DomainSubscriptionModel.findOne({ domainId: domain._id }))?.retentionEndsAt).toEqual(retentionEndsAt);
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

      const held = await MailboxModel.create({ tenantId, domainId: domain._id, localPart: 'held', address: 'held@suspend-me.com', status: 'suspended', billingHold: true });

      await reactivateDomainForPayment(domain._id.toString(), tenantId);
      expect((await DomainModel.findById(domain._id))?.status).toBe('active');
      expect((await MailboxModel.findById(mailbox._id))?.status).toBe('active');
      // Held mailboxes aren't billed, so payment doesn't switch them on.
      expect((await MailboxModel.findById(held._id))?.status).toBe('suspended');
    });

    it('a payment never reactivates a domain another tenant owns (the shared platform domain)', async () => {
      const owner = await TenantModel.create({ name: 'Platform', status: 'active', mailboxLimit: 1, mailboxCount: 0 });
      const platform = await DomainModel.create({ tenantId: owner._id, domainName: 'platform2.test', status: 'suspended' });
      await DomainSubscriptionModel.create({
        domainId: platform._id, tenantId, planId: fixedPlanId,
        stripeSubscriptionId: 'sub_plat', stripeSubscriptionItemId: 'si_plat', status: 'suspended',
      });

      await handleWebhookEvent({ id: 'evt_plat_paid', type: 'invoice.payment_succeeded', data: { object: { subscription: 'sub_plat', billing_reason: 'manual' } } } as any);

      expect((await DomainModel.findById(platform._id))?.status).toBe('suspended');
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

    it('reports to the dedicated meter when this domain has one, instead of the plan\'s shared meter', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'dedicated.com', planId: meteredPlanId, status: 'active' });
      const sub = await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: meteredPlanId,
        stripeSubscriptionId: 'sub_metered_2',
        stripeSubscriptionItemId: 'si_metered_2',
        status: 'active',
        dedicatedStripePriceId: 'price_dedicated_1',
        dedicatedMeterEventName: 'mailbox_count_custom_dedicated_1',
      });
      await TenantModel.updateOne({ _id: tenantId }, { stripeCustomerId: 'cus_test123' });
      await MailboxModel.create({ tenantId, domainId: domain._id, localPart: 'c', address: 'c@dedicated.com', status: 'active' });

      await reportMeteredUsage(domain._id.toString());

      expect(stripeClient.reportMeteredUsage).toHaveBeenLastCalledWith('mailbox_count_custom_dedicated_1', 'cus_test123', 1);
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
      vi.mocked(stripeClient.createDomainPrice).mockResolvedValue('price_bigger');

      await requestUpgrade(domain._id.toString(), tenantId, biggerPlan._id.toString(), actor);

      expect(stripeClient.updateSubscriptionItemPrice).toHaveBeenCalledWith('sub_up', 'si_up', 'price_bigger', 25);
      expect((await DomainModel.findById(domain._id))?.mailboxLimit).toBe(25);
    });

    it('requestUpgrade gives the domain its own licensed price even when a sibling already uses the target plan', async () => {
      const sibling = await DomainModel.create({ tenantId, domainName: 'sibling-on-target.com', planId: meteredPlanId, status: 'active' });
      await DomainSubscriptionModel.create({
        domainId: sibling._id,
        tenantId,
        planId: meteredPlanId,
        stripeSubscriptionId: 'sub_shared_up',
        stripeSubscriptionItemId: 'si_sibling_up',
        status: 'active',
      });

      const domain = await DomainModel.create({ tenantId, domainName: 'upgrading.com', planId: fixedPlanId, status: 'active' });
      await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: fixedPlanId,
        stripeSubscriptionId: 'sub_shared_up',
        stripeSubscriptionItemId: 'si_upgrading',
        status: 'active',
      });
      await MailboxModel.create({ tenantId, domainId: domain._id, localPart: 'a', address: 'a@upgrading.com', status: 'active', billingHold: false });

      // Stripe refuses a quantity on a metered price, and two items can't share one price.
      vi.mocked(stripeClient.createDomainPrice).mockResolvedValue('price_upgrading_custom');

      await requestUpgrade(domain._id.toString(), tenantId, meteredPlanId, actor);

      expect(stripeClient.createDomainPrice).toHaveBeenCalledWith({
        name: 'Custom — upgrading.com',
        unitAmountPaise: 15000,
        domainId: domain._id.toString(),
        planId: meteredPlanId,
      });
      expect(stripeClient.updateSubscriptionItemPrice).toHaveBeenCalledWith('sub_shared_up', 'si_upgrading', 'price_upgrading_custom', 1);
      const sub = await DomainSubscriptionModel.findOne({ domainId: domain._id });
      expect(sub?.planId?.toString()).toBe(meteredPlanId);
      expect(sub?.pricePerUserMonthlyPaise).toBe(15000);
    });

    it('requestUpgrade drops a downgrade the domain had pending', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'changed-mind.com', planId: fixedPlanId, status: 'active' });
      const sub = await DomainSubscriptionModel.create({
        domainId: domain._id, tenantId, planId: fixedPlanId, stripeSubscriptionId: 'sub_mind', stripeSubscriptionItemId: 'si_mind',
        status: 'active', pendingDowngradePlanId: fixedPlanId, pendingDowngradePriceId: 'price_mind_down',
      });
      vi.mocked(stripeClient.createDomainPrice).mockResolvedValue('price_mind_up');
      vi.mocked(stripeClient.setPendingPrices).mockClear();

      await requestUpgrade(domain._id.toString(), tenantId, meteredPlanId, actor);

      expect(stripeClient.setPendingPrices).toHaveBeenCalledWith('sub_mind', {});
      const row = await DomainSubscriptionModel.findById(sub._id);
      expect(row?.pendingDowngradePlanId).toBeNull();
      expect(row?.pendingDowngradePriceId).toBeNull();
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
      vi.mocked(stripeClient.createDomainPrice).mockResolvedValue('price_smaller');

      await requestDowngrade(domain._id.toString(), tenantId, smallerPlan._id.toString(), actor);

      expect(stripeClient.createDomainPrice).toHaveBeenCalledWith(expect.objectContaining({ name: 'Individual — downgrade.com', domainId: domain._id.toString() }));
      expect(stripeClient.setPendingPrices).toHaveBeenCalledWith('sub_down', { si_down: 'price_smaller' });
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
      // Its item is gone from the bill now, so its mail stops now; the other domain is unaffected.
      expect((await DomainModel.findById(domain2._id))?.status).toBe('suspended');
      const sibling = await DomainSubscriptionModel.findOne({ domainId: domain1._id });
      expect(sibling?.status).toBe('active');
      expect((await DomainModel.findById(domain1._id))?.status).toBe('active');
    });

    it('a cancelled domain stays cancelled through later subscription events, so the last domain left cancels the subscription', async () => {
      const keep = await DomainModel.create({ tenantId, domainName: 'keep2.com', planId: fixedPlanId, status: 'active' });
      const keepSub = await DomainSubscriptionModel.create({
        domainId: keep._id, tenantId, planId: fixedPlanId,
        stripeSubscriptionId: 'sub_two', stripeSubscriptionItemId: 'si_keep2', status: 'active',
      });
      const gone = await DomainModel.create({ tenantId, domainName: 'gone.com', planId: fixedPlanId, status: 'active' });
      const goneSub = await DomainSubscriptionModel.create({
        domainId: gone._id, tenantId, planId: fixedPlanId,
        stripeSubscriptionId: 'sub_two', stripeSubscriptionItemId: 'si_gone', status: 'active',
      });

      await cancelSubscription(gone._id.toString(), tenantId, actor);
      // Shapes Stripe sent in the live run after the item was removed.
      await handleWebhookEvent({
        id: 'evt_upd_after_remove',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_two', status: 'active', cancel_at_period_end: false, items: { data: [{ id: 'si_keep2', current_period_end: 1795000000 }] } } },
      } as any);
      await handleWebhookEvent({ id: 'evt_fail_after_remove', type: 'invoice.payment_failed', data: { object: { id: 'in_1', subscription: 'sub_two', created: 1795000000 } } } as any);
      await handleWebhookEvent({ id: 'evt_paid_after_remove', type: 'invoice.payment_succeeded', data: { object: { subscription: 'sub_two', billing_reason: 'subscription_cycle' } } } as any);

      expect((await DomainSubscriptionModel.findById(goneSub._id))?.status).toBe('canceled');
      expect((await DomainModel.findById(gone._id))?.status).toBe('suspended');
      expect(emailService.sendBillingGraceStartedEmail).toHaveBeenCalledTimes(1);
      expect((await DomainSubscriptionModel.findById(keepSub._id))?.status).toBe('active');

      await cancelSubscription(keep._id.toString(), tenantId, actor);
      expect(stripeClient.cancelAtPeriodEnd).toHaveBeenCalledWith('sub_two', true);
      expect(stripeClient.removeSubscriptionItem).toHaveBeenCalledTimes(1);
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

});
