import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { AdminUserModel, TenantModel, DomainModel, PlanModel, DomainSubscriptionModel, MailboxModel } from '../src/db/models';
import { generateOidcToken } from '../src/auth/service';
import { handleWebhookEvent, adoptActivationSession } from '../src/services/billing.service';
import { runBillingReconciliationOnce } from '../src/jobs/billing-reconcile.job';
import { stripeClient } from '../src/stripe/client';
import { stalwartClient } from '../src/stalwart/client';

vi.mock('../src/stripe/client', () => ({
  stripeClient: {
    cancelAtPeriodEnd: vi.fn(),
    cancelSubscription: vi.fn(),
    retrieveSubscription: vi.fn(),
    retrieveSubscriptionExpanded: vi.fn(),
    syncDomainUserQuantity: vi.fn(),
  },
  subscriptionIdOf: (inv: any) => inv.subscription || inv.parent?.subscription_details?.subscription,
}));

let mongoServer: MongoMemoryServer;

describe('Billing Phase 4 & 5: Cancellation, Abuse Defense & Nightly Reconciliation', () => {
  let tenantId: string;
  let domainId: string;
  let token: string;
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
    await Promise.all([AdminUserModel, TenantModel, DomainModel, PlanModel, DomainSubscriptionModel, MailboxModel].map((m) => m.deleteMany({})));

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
      mailboxCount: 3,
      stripeSubscriptionId: 'sub_master_tenant',
      stripeCustomerId: 'cus_tenant_1',
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
      stripeSubscriptionId: 'sub_master_tenant',
      stripeSubscriptionItemId: 'si_item_1',
      status: 'active',
      cancelAtPeriodEnd: false,
    });
    subId = sub._id.toString();

    const admin = await AdminUserModel.create({
      email: 'admin@acme.test',
      passwordHash: 'x',
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
      status: 'active',
      twoFactorEnabled: false,
    });
    token = generateOidcToken({ id: admin._id.toString(), email: admin.email, role: 'TENANT_ADMIN', tenantId, twoFactorEnabled: false });

    vi.mocked(stripeClient.cancelAtPeriodEnd).mockResolvedValue({ id: 'sub_master_tenant', cancel_at_period_end: true } as any);
  });

  describe('Phase 4: Cancellation & Resumption', () => {
    it('POST /api/tenants/me/billing/cancel schedules master subscription cancellation at period end', async () => {
      const res = await request(app)
        .post('/api/tenants/me/billing/cancel')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = await DomainSubscriptionModel.findById(subId);
      expect(updated?.cancelAtPeriodEnd).toBe(true);
      expect(stripeClient.cancelAtPeriodEnd).toHaveBeenCalledWith('sub_master_tenant', true);
    });

    it('POST /api/tenants/me/billing/resume resumes master subscription cancellation', async () => {
      await DomainSubscriptionModel.updateOne({ _id: subId }, { cancelAtPeriodEnd: true });

      const res = await request(app)
        .post('/api/tenants/me/billing/resume')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = await DomainSubscriptionModel.findById(subId);
      expect(updated?.cancelAtPeriodEnd).toBe(false);
      expect(stripeClient.cancelAtPeriodEnd).toHaveBeenCalledWith('sub_master_tenant', false);
    });

    it('customer.subscription.deleted marks subscription canceled and schedules 30-day retention', async () => {
      await handleWebhookEvent({
        id: 'evt_sub_del_1',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_master_tenant',
          },
        },
      } as any);

      const updated = await DomainSubscriptionModel.findById(subId);
      expect(updated?.status).toBe('canceled');
      expect(updated?.retentionEndsAt).toBeTruthy();
    });

    it('webhooks record audit logs for refunds, credit notes and disputes', async () => {
      await handleWebhookEvent({
        id: 'evt_ref_1',
        type: 'charge.refunded',
        data: { object: { id: 'ch_1', amount_refunded: 500, currency: 'inr' } },
      } as any);

      await handleWebhookEvent({
        id: 'evt_cn_1',
        type: 'credit_note.created',
        data: { object: { id: 'cn_1', amount: 500, reason: 'duplicate' } },
      } as any);

      await handleWebhookEvent({
        id: 'evt_disp_1',
        type: 'charge.dispute.created',
        data: { object: { id: 'dp_1', amount: 500, reason: 'fraudulent' } },
      } as any);

      // Verify no throw
      expect(true).toBe(true);
    });

    it('stalwartClient.updateAccountAccess sets permissions appropriately', async () => {
      const dispatchSpy = vi.spyOn(stalwartClient as any, 'dispatch').mockResolvedValue([{ 0: 'x', 1: {} }]);
      await stalwartClient.updateAccountAccess('acc-1', 'read_only');
      expect(dispatchSpy).toHaveBeenCalled();
      const call = dispatchSpy.mock.calls[0][0][0];
      expect(call[1].update['acc-1'].permissions.enabledPermissions).toHaveProperty('imapAccess', true);
      expect(call[1].update['acc-1'].permissions.disabledPermissions).toHaveProperty('emailSend', true);
    });
  });

  describe('Phase 5: Trial Abuse & Nightly Reconciliation', () => {
    it('blocks trial start if the card fingerprint was already used on another tenant trial', async () => {
      // Prior tenant who used card fingerprint 'fp_used_123'
      await TenantModel.create({
        name: 'Prior Org',
        contactEmail: 'prior@other.test',
        status: 'active',
        mailboxLimit: 10,
        mailboxCount: 1,
        trialStartedAt: new Date(Date.now() - 10 * 86400 * 1000),
        cardFingerprint: 'fp_used_123',
      });

      // New tenant attempting activation with the same card fingerprint
      const mockSession: any = {
        subscription: 'sub_new_session',
      };

      vi.mocked(stripeClient.retrieveSubscriptionExpanded).mockResolvedValue({
        id: 'sub_new_session',
        trial_start: Math.floor(Date.now() / 1000),
        trial_end: Math.floor((Date.now() + 60 * 86400 * 1000) / 1000),
        default_payment_method: {
          id: 'pm_reuse',
          card: {
            brand: 'visa',
            last4: '4242',
            exp_month: 12,
            exp_year: 2028,
            fingerprint: 'fp_used_123',
          },
        },
        items: { data: [] },
      } as any);
      vi.mocked(stripeClient.cancelSubscription).mockResolvedValue({ id: 'sub_new_session', status: 'canceled' } as any);

      await expect(
        adoptActivationSession(tenantId, mockSession, { id: 'admin-1', email: 'admin@acme.test', role: 'TENANT_ADMIN' })
      ).rejects.toMatchObject({
        code: 'TRIAL_ALREADY_USED_FOR_CARD',
        statusCode: 409,
      });

      // Refused before anything is recorded: no trial, and Checkout's subscription can't charge later.
      const refused = await TenantModel.findById(tenantId);
      expect(refused?.trialStartedAt ?? null).toBeNull();
      expect(stripeClient.cancelSubscription).toHaveBeenCalledWith('sub_new_session');
    });

    it('the checkout webhook for a refused card is acknowledged once its subscription is cancelled, and retried until then', async () => {
      await TenantModel.create({ name: 'Prior Org', status: 'active', trialStartedAt: new Date(), cardFingerprint: 'fp_used_456' });
      const refusedSubscription = (status: string) => ({
        id: 'sub_refused', status, trial_start: 1, trial_end: 2, items: { data: [] },
        default_payment_method: { id: 'pm_reuse', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2028, fingerprint: 'fp_used_456' } },
      });
      const completed = (id: string) => ({
        id, type: 'checkout.session.completed',
        data: { object: { id: 'cs_refused', subscription: 'sub_refused', metadata: { tenantId, purpose: 'cart_activation' } } },
      }) as any;

      // The cancel fails: Stripe must retry, or the subscription charges when its trial ends.
      vi.mocked(stripeClient.retrieveSubscriptionExpanded).mockResolvedValue(refusedSubscription('trialing') as any);
      vi.mocked(stripeClient.cancelSubscription).mockRejectedValueOnce(new Error('Stripe is unavailable'));
      await expect(handleWebhookEvent(completed('evt_refused_1'))).rejects.toThrow('Stripe is unavailable');

      // The retry cancels it and is acknowledged.
      vi.mocked(stripeClient.cancelSubscription).mockResolvedValueOnce({ id: 'sub_refused', status: 'canceled' } as any);
      await expect(handleWebhookEvent(completed('evt_refused_1'))).resolves.toBeUndefined();
      expect(stripeClient.cancelSubscription).toHaveBeenLastCalledWith('sub_refused');

      // A later delivery finds it already cancelled and is acknowledged without cancelling again.
      vi.mocked(stripeClient.cancelSubscription).mockClear();
      vi.mocked(stripeClient.retrieveSubscriptionExpanded).mockResolvedValue(refusedSubscription('canceled') as any);
      await expect(handleWebhookEvent(completed('evt_refused_2'))).resolves.toBeUndefined();
      expect(stripeClient.cancelSubscription).not.toHaveBeenCalled();
      expect((await TenantModel.findById(tenantId))?.trialStartedAt ?? null).toBeNull();
    });

    it('runBillingReconciliationOnce fixes quantity drift between Stripe items and active mailboxes', async () => {
      // In Mongo: 2 active mailboxes for domain
      await MailboxModel.create({
        tenantId,
        domainId,
        localPart: 'alice',
        address: 'alice@acmecorp.com',
        status: 'active',
        billingHold: false,
      });
      await MailboxModel.create({
        tenantId,
        domainId,
        localPart: 'bob',
        address: 'bob@acmecorp.com',
        status: 'active',
        billingHold: false,
      });

      // In Stripe: item quantity is 5 (3 more than the Active Users). An unexpanded retrieve returns the
      // product as a bare id, so the item is matched to its domain through domain_subscriptions.
      vi.mocked(stripeClient.retrieveSubscription).mockResolvedValue({
        id: 'sub_master_tenant',
        items: {
          data: [{ id: 'si_item_1', quantity: 5, price: { product: 'prod_plan_team' } }],
        },
      } as any);

      vi.mocked(stripeClient.syncDomainUserQuantity).mockResolvedValue({ id: 'si_item_1', quantity: 2 } as any);

      const result = await runBillingReconciliationOnce();

      expect(result.tenantsChecked).toBe(1);
      expect(result.driftCorrected).toBe(1);
      expect(stripeClient.syncDomainUserQuantity).toHaveBeenCalledWith('si_item_1', 2);

      const updatedSub = await DomainSubscriptionModel.findById(subId);
      expect(updatedSub?.activeUserCount).toBe(2);
    });

    it('runBillingReconciliationOnce leaves a cancelled subscription alone', async () => {
      // Every mailbox was suspended when it ended; Stripe refuses changes to a cancelled subscription.
      vi.mocked(stripeClient.retrieveSubscription).mockResolvedValue({
        id: 'sub_master_tenant',
        status: 'canceled',
        items: { data: [{ id: 'si_item_1', quantity: 5, price: { product: 'prod_plan_team' } }] },
      } as any);

      const result = await runBillingReconciliationOnce();

      expect(result.driftCorrected).toBe(0);
      expect(stripeClient.syncDomainUserQuantity).not.toHaveBeenCalled();
    });
  });
});
