import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { config } from '../src/config';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import {
  TenantModel,
  DomainModel,
  DomainSubscriptionModel,
  MailboxModel,
  PlanModel,
  StripeEventModel,
} from '../src/db/models';
import { emailService } from '../src/services/email.service';

// Real Stripe signature verification, offline: signed with a throwaway secret, not the .env one.
const SECRET = 'whsec_test_secret_for_webhook_reliability_tests_12345';
const original = { ...config.stripe };

let mongoServer: MongoMemoryServer;

describe('POST /api/webhooks/stripe signature checks and reliability (scenario 9)', () => {
  beforeAll(async () => {
    config.stripe.secretKey = 'sk_test_dummy';
    config.stripe.webhookSecret = SECRET;
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri(), autoIndex: true });
  });

  afterAll(async () => {
    Object.assign(config.stripe, original);
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await DomainSubscriptionModel.deleteMany({});
    await MailboxModel.deleteMany({});
    await PlanModel.deleteMany({});
    await StripeEventModel.deleteMany({});
  });

  const payload = JSON.stringify({ id: 'evt_test_ping', object: 'event', type: 'ping' });

  it('rejects a request with no signature with 400 and creates no event record', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_SIGNATURE');
    expect(await StripeEventModel.countDocuments({})).toBe(0);
  });

  it('rejects a request signed with the wrong secret with 400 and leaves database untouched', async () => {
    const forged = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_attacker_secret_9999999999' });
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', forged)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('STRIPE_WEBHOOK_SIGNATURE_INVALID');
    expect(await StripeEventModel.countDocuments({})).toBe(0);
  });

  it('resending an already-processed event returns 200, leaves state unchanged, and sends no duplicate email', async () => {
    const tenant = await TenantModel.create({
      name: 'Acme Corp',
      contactEmail: 'admin@acme.test',
      status: 'active',
      mailboxLimit: 10,
      mailboxCount: 1,
      stripeSubscriptionId: 'sub_scenario9',
    });

    const plan = await PlanModel.create({
      name: 'Starter',
      seatCount: 10,
      monthlyPriceInPaise: 4900,
      isActive: true,
    });

    const domain = await DomainModel.create({
      tenantId: tenant._id,
      domainName: 'acme.com',
      planId: plan._id,
      status: 'active',
      dnsStatus: 'active',
      isPrimary: true,
    });

    const trialEnd = new Date(Date.now() + 3 * 86400000);
    const domainSub = await DomainSubscriptionModel.create({
      domainId: domain._id,
      tenantId: tenant._id,
      planId: plan._id,
      stripeSubscriptionId: 'sub_scenario9',
      stripeSubscriptionItemId: 'si_item9',
      status: 'trialing',
      trialEnd,
      currentPeriodEnd: trialEnd,
      activeUserCount: 1,
      pricePerUserMonthlyPaise: 4900,
    });

    const emailSpy = vi.spyOn(emailService, 'sendBillingNoticeEmail').mockResolvedValue({
      success: true,
      messageId: 'msg_trial_end_1',
    });

    const eventId = 'evt_trial_will_end_001';
    const trialWillEndPayload = JSON.stringify({
      id: eventId,
      object: 'event',
      type: 'customer.subscription.trial_will_end',
      data: {
        object: {
          id: 'sub_scenario9',
          object: 'subscription',
          trial_end: Math.floor(trialEnd.getTime() / 1000),
        },
      },
    });

    const validHeader = Stripe.webhooks.generateTestHeaderString({
      payload: trialWillEndPayload,
      secret: SECRET,
    });

    // 1. First delivery
    const res1 = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', validHeader)
      .send(trialWillEndPayload);

    expect(res1.status).toBe(200);
    expect(res1.body).toEqual({ received: true });
    expect(emailSpy).toHaveBeenCalledTimes(1);

    const eventDoc = await StripeEventModel.findOne({ eventId });
    expect(eventDoc).not.toBeNull();
    expect(eventDoc?.type).toBe('customer.subscription.trial_will_end');

    // 2. Replay the EXACT same event (second delivery)
    const res2 = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', validHeader)
      .send(trialWillEndPayload);

    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ received: true });

    // State is unchanged and NO second email was dispatched
    expect(emailSpy).toHaveBeenCalledTimes(1);

    const subAfterReplay = await DomainSubscriptionModel.findById(domainSub._id);
    expect(subAfterReplay?.status).toBe('trialing');
    expect(subAfterReplay?.trialEnd?.getTime()).toBe(trialEnd.getTime());

    const tenantAfterReplay = await TenantModel.findById(tenant._id);
    expect(tenantAfterReplay?.status).toBe('active');
    expect(await StripeEventModel.countDocuments({ eventId })).toBe(1);
  });

  it('forced handler failure returns 500, releases event id, and the retried delivery is applied exactly once', async () => {
    const tenant = await TenantModel.create({
      name: 'Retry Org',
      contactEmail: 'billing@retry.test',
      status: 'active',
      mailboxLimit: 10,
      mailboxCount: 1,
      stripeSubscriptionId: 'sub_retry_test',
    });

    const plan = await PlanModel.create({
      name: 'Starter',
      seatCount: 10,
      monthlyPriceInPaise: 4900,
      isActive: true,
    });

    const domain = await DomainModel.create({
      tenantId: tenant._id,
      domainName: 'retry.com',
      planId: plan._id,
      status: 'active',
      dnsStatus: 'active',
      isPrimary: true,
    });

    await DomainSubscriptionModel.create({
      domainId: domain._id,
      tenantId: tenant._id,
      planId: plan._id,
      stripeSubscriptionId: 'sub_retry_test',
      stripeSubscriptionItemId: 'si_retry_test',
      status: 'trialing',
      trialEnd: new Date(Date.now() + 30 * 86400000),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      activeUserCount: 1,
      pricePerUserMonthlyPaise: 4900,
    });

    const eventId = 'evt_payment_failed_retry_test';
    const paymentFailedPayload = JSON.stringify({
      id: eventId,
      object: 'event',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_failed_retry_test',
          object: 'invoice',
          subscription: 'sub_retry_test',
        },
      },
    });

    const header = Stripe.webhooks.generateTestHeaderString({
      payload: paymentFailedPayload,
      secret: SECRET,
    });

    // Mock emailService to fail on attempt 1, then succeed on attempt 2
    let attempt = 0;
    const emailSpy = vi.spyOn(emailService, 'sendBillingGraceStartedEmail').mockImplementation(async () => {
      attempt++;
      if (attempt === 1) {
        throw new Error('Database/SMTP connection dropped during handler execution');
      }
      return { success: true, messageId: 'msg_grace_ok' };
    });

    // 1. Delivery 1: handler fails -> 500 error returned to Stripe
    const failRes = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(paymentFailedPayload);

    expect(failRes.status).toBe(500);
    expect(failRes.body.error).toBe('WEBHOOK_HANDLER_ERROR');

    // The event ID must NOT remain in StripeEventModel (must be released so Stripe retry can proceed)
    expect(await StripeEventModel.findOne({ eventId })).toBeNull();

    // 2. Delivery 2: Stripe retries delivery -> now succeeds
    const retryRes = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(paymentFailedPayload);

    expect(retryRes.status).toBe(200);
    expect(retryRes.body).toEqual({ received: true });
    expect(emailSpy).toHaveBeenCalledTimes(2);

    // Event ID is recorded after successful processing
    const savedEvent = await StripeEventModel.findOne({ eventId });
    expect(savedEvent).not.toBeNull();
    expect(savedEvent?.type).toBe('invoice.payment_failed');

    // Domain subscription was moved to grace
    const sub = await DomainSubscriptionModel.findOne({ stripeSubscriptionId: 'sub_retry_test' });
    expect(sub?.status).toBe('grace');
    expect(sub?.lastPaymentFailedInvoiceId).toBe('in_failed_retry_test');

    // 3. Delivery 3: Replay after successful retry -> skipped
    const replayRes = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(paymentFailedPayload);

    expect(replayRes.status).toBe(200);
    expect(replayRes.body).toEqual({ received: true });
    // Still 2 calls to email (1 fail + 1 success), no third call
    expect(emailSpy).toHaveBeenCalledTimes(2);
  });
});
