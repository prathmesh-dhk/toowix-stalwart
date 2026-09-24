import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { TenantModel, DomainModel, PlanModel, DomainSubscriptionModel } from '../src/db/models';
import { emailService } from '../src/services/email.service';
import { handleWebhookEvent } from '../src/services/billing.service';
import { runTrialReminderSweepOnce } from '../src/jobs/trial-reminder-sweep.job';
import { runGraceSweepOnce } from '../src/jobs/billing-grace-sweep.job';
import { stripeClient } from '../src/stripe/client';

vi.mock('../src/stripe/client', () => ({
  stripeClient: {
    payInvoice: vi.fn(),
  },
  subscriptionIdOf: (inv: any) => inv.subscription || inv.parent?.subscription_details?.subscription,
}));

let mongoServer: MongoMemoryServer;
const DAY = 24 * 60 * 60 * 1000;

describe('Billing Phase 3: Trial Reminders, Grace Notices & Payment Retries', () => {
  let tenantId: string;
  let domainId: string;
  let subId: string;

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
    await Promise.all([TenantModel, DomainModel, PlanModel, DomainSubscriptionModel].map((m) => m.deleteMany({})));

    const plan = await PlanModel.create({
      name: 'Team',
      seatCount: 10,
      displayOrder: 1,
      isActive: true,
      billingMode: 'fixed',
      monthlyPriceInPaise: 100000,
    });

    const tenant = await TenantModel.create({
      name: 'Acme Corp',
      contactEmail: 'billing@acme.test',
      status: 'active',
      mailboxLimit: 50,
      mailboxCount: 5,
      trialStartedAt: new Date(Date.now() - 40 * DAY),
      trialEndsAt: new Date(Date.now() + 20 * DAY),
      stripeSubscriptionId: 'sub_trial_phase3',
      paymentMethods: [{ id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2028, isDefault: true, createdAt: new Date() }],
    });
    tenantId = tenant._id.toString();

    const domain = await DomainModel.create({
      tenantId,
      domainName: 'acmecorp.com',
      planId: plan._id,
      planName: 'Team',
      mailboxLimit: 10,
      status: 'active',
      dnsStatus: 'active',
      isPrimary: true,
    });
    domainId = domain._id.toString();

    const sub = await DomainSubscriptionModel.create({
      domainId: domain._id,
      tenantId: tenant._id,
      planId: plan._id,
      stripeSubscriptionId: 'sub_trial_phase3',
      stripeSubscriptionItemId: 'si_1',
      status: 'trialing',
      trialEnd: new Date(Date.now() + 20 * DAY),
    });
    subId = sub._id.toString();

    vi.spyOn(emailService, 'sendBillingNoticeEmail').mockResolvedValue({ success: true });
    vi.mocked(stripeClient.payInvoice).mockResolvedValue({ id: 'in_123', status: 'paid' } as any);
  });

  describe('Trial End Reminders', () => {
    it('customer.subscription.trial_will_end webhook dispatches notice email to tenant contact', async () => {
      await handleWebhookEvent({
        id: 'evt_trial_end_1',
        type: 'customer.subscription.trial_will_end',
        data: {
          object: {
            id: 'sub_trial_phase3',
            trial_end: Math.floor((Date.now() + 3 * DAY) / 1000),
          },
        },
      } as any);

      expect(emailService.sendBillingNoticeEmail).toHaveBeenCalledTimes(1);
      const call = vi.mocked(emailService.sendBillingNoticeEmail).mock.calls[0][0];
      expect(call.to).toBe('billing@acme.test');
      expect(call.subject).toMatch(/trial ends in 3 days/i);
      expect(call.paragraphs.join(' ')).toContain('•••• 4242');
    });

    it('runTrialReminderSweepOnce fires at Day 45, Day 55, and Day 59 and is idempotent', async () => {
      // Day 40: no reminder yet
      let res = await runTrialReminderSweepOnce();
      expect(res.reminded).toBe(0);
      expect(emailService.sendBillingNoticeEmail).toHaveBeenCalledTimes(0);

      // Advance to Day 46: Day 45 milestone fires
      const day46 = new Date(Date.now() + 6 * DAY);
      res = await runTrialReminderSweepOnce(day46);
      expect(res.reminded).toBe(1);
      expect(emailService.sendBillingNoticeEmail).toHaveBeenCalledTimes(1);
      expect(vi.mocked(emailService.sendBillingNoticeEmail).mock.calls[0][0].subject).toContain('ends in 14 days');

      // Re-running on day 46 does nothing (idempotency check)
      res = await runTrialReminderSweepOnce(day46);
      expect(res.reminded).toBe(0);
      expect(emailService.sendBillingNoticeEmail).toHaveBeenCalledTimes(1);

      // Advance to Day 56: Day 55 milestone fires
      const day56 = new Date(Date.now() + 16 * DAY);
      res = await runTrialReminderSweepOnce(day56);
      expect(res.reminded).toBe(1);
      expect(emailService.sendBillingNoticeEmail).toHaveBeenCalledTimes(2);
      expect(vi.mocked(emailService.sendBillingNoticeEmail).mock.calls[1][0].subject).toContain('ends in 4 days');

      // Advance to Day 59.5: Day 59 milestone fires
      const day59Half = new Date(Date.now() + 19.5 * DAY);
      res = await runTrialReminderSweepOnce(day59Half);
      expect(res.reminded).toBe(1);
      expect(emailService.sendBillingNoticeEmail).toHaveBeenCalledTimes(3);
      expect(vi.mocked(emailService.sendBillingNoticeEmail).mock.calls[2][0].subject).toContain('ends in 1 days');
    });
  });

  describe('Payment Failures, Grace Notices & Invoicing Retries', () => {
    it('invoice.payment_action_required webhook emails hosted invoice authorization link', async () => {
      await handleWebhookEvent({
        id: 'evt_act_req_1',
        type: 'invoice.payment_action_required',
        data: {
          object: {
            id: 'in_auth_required',
            subscription: 'sub_trial_phase3',
            hosted_invoice_url: 'https://stripe.com/pay/in_auth_required',
          },
        },
      } as any);

      expect(emailService.sendBillingNoticeEmail).toHaveBeenCalledTimes(1);
      const call = vi.mocked(emailService.sendBillingNoticeEmail).mock.calls[0][0];
      expect(call.to).toBe('billing@acme.test');
      expect(call.subject).toMatch(/Payment authorization required/i);
      expect(call.paragraphs.join(' ')).toContain('https://stripe.com/pay/in_auth_required');
    });

    it('invoice.payment_failed sets grace period and sends Day 0 notice', async () => {
      await handleWebhookEvent({
        id: 'evt_pay_failed_1',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_failed_cycle_1',
            subscription: 'sub_trial_phase3',
          },
        },
      } as any);

      const sub = await DomainSubscriptionModel.findById(subId);
      expect(sub?.status).toBe('grace');
      expect(sub?.lastPaymentFailedInvoiceId).toBe('in_failed_cycle_1');
      expect(sub?.graceNoticesSent).toContain(0);
      expect(sub?.gracePeriodEndsAt).toBeTruthy();
    });

    it('grace sweep sends Day 3 reminder notice when 4 days remain', async () => {
      // Put subscription in grace ending in 4 days
      await DomainSubscriptionModel.updateOne(
        { _id: subId },
        {
          status: 'grace',
          gracePeriodEndsAt: new Date(Date.now() + 4 * DAY),
          graceNoticesSent: [0],
          lastPaymentFailedInvoiceId: 'in_retry_1',
        }
      );

      const res = await runGraceSweepOnce();
      expect(res.noticesSent).toBe(1);
      expect(emailService.sendBillingNoticeEmail).toHaveBeenCalledTimes(1);
      const call = vi.mocked(emailService.sendBillingNoticeEmail).mock.calls[0][0];
      expect(call.subject).toContain('4 days left');

      // Re-running does not duplicate Day 3 notice
      const res2 = await runGraceSweepOnce();
      expect(res2.noticesSent).toBe(0);
      expect(emailService.sendBillingNoticeEmail).toHaveBeenCalledTimes(1);
    });

    it('grace sweep sends Day 6 final notice when 1 day remains', async () => {
      // Put subscription in grace ending in 1 day
      await DomainSubscriptionModel.updateOne(
        { _id: subId },
        {
          status: 'grace',
          gracePeriodEndsAt: new Date(Date.now() + 1 * DAY),
          graceNoticesSent: [0, 3],
          lastPaymentFailedInvoiceId: 'in_retry_1',
        }
      );

      const res = await runGraceSweepOnce();
      expect(res.noticesSent).toBe(1);
      expect(emailService.sendBillingNoticeEmail).toHaveBeenCalledTimes(1);
      const call = vi.mocked(emailService.sendBillingNoticeEmail).mock.calls[0][0];
      expect(call.subject).toContain('Final 24 hours');
    });

    it('grace sweep attempts automated invoice retry and restores active status on success', async () => {
      await DomainSubscriptionModel.updateOne(
        { _id: subId },
        {
          status: 'grace',
          gracePeriodEndsAt: new Date(Date.now() + 4 * DAY),
          lastPaymentFailedInvoiceId: 'in_retry_success',
          lastPaymentRetryAt: null,
        }
      );

      const res = await runGraceSweepOnce();
      expect(res.retriesAttempted).toBe(1);
      expect(stripeClient.payInvoice).toHaveBeenCalledWith('in_retry_success');

      const updated = await DomainSubscriptionModel.findById(subId);
      expect(updated?.status).toBe('active');
      expect(updated?.gracePeriodEndsAt).toBeNull();
      expect(updated?.lastPaymentFailedInvoiceId).toBeNull();
    });
  });
});
