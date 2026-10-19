import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { AdminUserModel, TenantModel, DomainModel, PlanModel, DomainSubscriptionModel, MailboxModel } from '../src/db/models';
import { generateOidcToken } from '../src/auth/service';

vi.mock('../src/stripe/client', () => ({
  stripeClient: {
    getOrCreateCustomer: vi.fn().mockResolvedValue('cus_test'),
    getOrCreatePrice: vi.fn().mockResolvedValue('price_test'),
    createCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test' }),
    retrieveSubscription: vi.fn(),
    updateSubscriptionItemPrice: vi.fn(),
    scheduleDowngrade: vi.fn(),
    cancelAtPeriodEnd: vi.fn(),
    reportMeteredUsage: vi.fn(),
    listInvoices: vi.fn().mockResolvedValue([]),
    createSetupIntent: vi.fn().mockResolvedValue({ client_secret: 'seti_test_secret' }),
    addSubscriptionItem: vi.fn().mockResolvedValue({ id: 'si_added' }),
    addDomainSubscriptionItem: vi.fn().mockResolvedValue({ id: 'si_domain_added' }),
    syncDomainUserQuantity: vi.fn().mockResolvedValue({}),
    listPaymentMethods: vi.fn().mockResolvedValue([{ id: 'pm_real_1' }]),
    attachPaymentMethod: vi.fn().mockResolvedValue({}),
    setDefaultPaymentMethod: vi.fn().mockResolvedValue({}),
    createActivationCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/activation-session' }),
    createCardUpdateCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/card-session' }),
    retrieveCheckoutSession: vi.fn(),
    retrieveSubscriptionExpanded: vi.fn(),
    setSubscriptionDefaultPaymentMethod: vi.fn().mockResolvedValue(undefined),
  },
  meterEventNameForPlan: (plan: any) => `mailbox_count_${plan._id.toString()}`,
}));

let mongoServer: MongoMemoryServer;

describe('Billing routes (/api/tenants/me/billing)', () => {
  let tenantId: string;
  let tenantAdminToken: string;
  let planId: string;
  let domainId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri(), autoIndex: true });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await AdminUserModel.deleteMany({});
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await PlanModel.deleteMany({});
    await DomainSubscriptionModel.deleteMany({});
    await MailboxModel.deleteMany({});

    const tenant = await TenantModel.create({ name: 'Acme', status: 'active', mailboxLimit: 50, mailboxCount: 0 });
    tenantId = tenant._id.toString();

    const plan = await PlanModel.create({ name: 'Team', seatCount: 10, displayOrder: 1, isActive: true, monthlyPriceInPaise: 100000 });
    planId = plan._id.toString();

    const domain = await DomainModel.create({
      tenantId,
      domainName: 'acme.com',
      planId,
      status: 'active',
      dnsStatus: 'active',
      isPrimary: true,
    });
    domainId = domain._id.toString();

    const admin = await AdminUserModel.create({
      email: 'admin@acme.test',
      passwordHash: 'dummyhash',
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
      status: 'active',
      twoFactorEnabled: false,
    });
    tenantAdminToken = generateOidcToken({
      id: admin._id.toString(),
      email: admin.email,
      role: 'TENANT_ADMIN',
      tenantId,
      twoFactorEnabled: false,
    });
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get(`/api/tenants/me/billing/domains/${domainId}`);
    expect(res.status).toBe(401);
  });

  it('starts a Checkout session for a domain with a plan', async () => {
    const res = await request(app)
      .post(`/api/tenants/me/billing/domains/${domainId}/checkout`)
      .set('Authorization', `Bearer ${tenantAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://checkout.stripe.com/test');
  });

  it('returns 404 for a domain belonging to another tenant', async () => {
    const otherTenant = await TenantModel.create({ name: 'Other', status: 'active', mailboxLimit: 10, mailboxCount: 0 });
    const otherDomain = await DomainModel.create({ tenantId: otherTenant._id, domainName: 'other.com', planId, status: 'active' });

    const res = await request(app)
      .post(`/api/tenants/me/billing/domains/${otherDomain._id}/checkout`)
      .set('Authorization', `Bearer ${tenantAdminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('DOMAIN_NOT_FOUND');
  });

  it('returns the domain billing status (no subscription yet)', async () => {
    const res = await request(app)
      .get(`/api/tenants/me/billing/domains/${domainId}`)
      .set('Authorization', `Bearer ${tenantAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.domainName).toBe('acme.com');
    expect(res.body.subscription).toBeNull();
  });

  it('returns a client secret for the payment-method setup intent', async () => {
    const res = await request(app)
      .post(`/api/tenants/me/billing/domains/${domainId}/setup-intent`)
      .set('Authorization', `Bearer ${tenantAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toBe('seti_test_secret');
  });

  it('lists invoices for the tenant (empty when no Stripe customer yet)', async () => {
    const res = await request(app)
      .get('/api/tenants/me/billing/invoices')
      .set('Authorization', `Bearer ${tenantAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.invoices).toEqual([]);
  });

  it('rejects cancel when the domain has no subscription yet', async () => {
    const res = await request(app)
      .post(`/api/tenants/me/billing/domains/${domainId}/cancel`)
      .set('Authorization', `Bearer ${tenantAdminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('NO_SUBSCRIPTION');
  });

  it('creates a mailbox on billing hold (suspended, pending activation) when the tenant has not confirmed a payment method', async () => {
    const { stalwartClient } = await import('../src/stalwart/client');
    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([{ id: 'stalwart-dom-1', name: 'acme.com' } as any]);
    vi.spyOn(stalwartClient, 'createAccount').mockResolvedValue({ id: 'acc-held', name: 'held' } as any);
    const suspendSpy = vi.spyOn(stalwartClient, 'updateAccountStatus').mockResolvedValue(undefined as any);

    const res = await request(app)
      .post('/api/tenants/me/mailboxes')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ localPart: 'held', password: 'Password123!', domainId });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('suspended');
    expect(res.body.billingHold).toBe(true);
    expect(suspendSpy).toHaveBeenCalledWith('acc-held', true);

    const cart = await request(app).get('/api/tenants/me/cart').set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(cart.status).toBe(200);
    expect(cart.body.requiresActivation).toBe(true);
    expect(cart.body.trial.started).toBe(false);
    expect(cart.body.pendingMailboxes.map((m: any) => m.address)).toEqual(['held@acme.com']);

    // A held mailbox can't be reactivated by hand — it has to go through the cart.
    const reactivate = await request(app)
      .post(`/api/mailboxes/${res.body.id}/reactivate`)
      .set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(reactivate.status).toBe(402);
    expect(reactivate.body.error).toBe('PAYMENT_METHOD_REQUIRED');
  });

  it('cart activation confirms the card, starts ONE trial, releases held mailboxes, and later mailboxes are live at once', async () => {
    process.env.SKIP_BILLING = 'true';
    try {
      const { stalwartClient } = await import('../src/stalwart/client');
      vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([{ id: 'stalwart-dom-1', name: 'acme.com' } as any]);
      vi.spyOn(stalwartClient, 'createAccount')
        .mockResolvedValueOnce({ id: 'acc-1', name: 'one' } as any)
        .mockResolvedValueOnce({ id: 'acc-2', name: 'two' } as any);
      vi.spyOn(stalwartClient, 'updateAccountStatus').mockResolvedValue(undefined as any);

      const first = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ localPart: 'one', password: 'Password123!', domainId });
      expect(first.body.status).toBe('suspended');

      const activate = await request(app)
        .post('/api/tenants/me/cart/activate')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 });
      expect(activate.status).toBe(200);
      expect(activate.body.activatedMailboxes).toBe(1);
      expect(activate.body.cart.trial.started).toBe(true);
      expect(activate.body.cart.pendingMailboxes).toEqual([]);

      const trialStart = (await TenantModel.findById(tenantId))!.trialStartedAt!.getTime();
      expect((await MailboxModel.findOne({ address: 'one@acme.com' }))?.status).toBe('active');

      // Activating again never restarts the trial.
      const again = await request(app)
        .post('/api/tenants/me/cart/activate')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({});
      expect(again.status).toBe(200);
      expect((await TenantModel.findById(tenantId))!.trialStartedAt!.getTime()).toBe(trialStart);

      const second = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ localPart: 'two', password: 'Password123!', domainId });
      expect(second.status).toBe(201);
      expect(second.body.status).toBe('active');
      expect(second.body.billingHold).toBe(false);
    } finally {
      delete process.env.SKIP_BILLING;
    }
  });

  async function holdOneMailbox(localPart = 'held', accountId = 'acc-held') {
    const { stalwartClient } = await import('../src/stalwart/client');
    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([{ id: 'stalwart-dom-1', name: 'acme.com' } as any]);
    vi.spyOn(stalwartClient, 'createAccount').mockResolvedValue({ id: accountId, name: localPart } as any);
    vi.spyOn(stalwartClient, 'updateAccountStatus').mockResolvedValue(undefined as any);
    const res = await request(app)
      .post('/api/tenants/me/mailboxes')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ localPart, password: 'Password123!', domainId });
    expect(res.body.billingHold).toBe(true);
    return res.body;
  }

  it('with Stripe, sandbox activation is refused — the trial only starts through Stripe checkout', async () => {
    await holdOneMailbox();
    const res = await request(app)
      .post('/api/tenants/me/cart/activate')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ brand: 'visa', last4: '4242' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('USE_CHECKOUT');
    expect((await TenantModel.findById(tenantId))!.trialStartedAt).toBeNull();
  });

  it('cart checkout: sandbox without Stripe; with Stripe a subscription checkout with one line per domain that has users, nothing charged today', async () => {
    const { stripeClient } = await import('../src/stripe/client');
    process.env.SKIP_BILLING = 'true';
    const sandbox = await request(app).post('/api/tenants/me/cart/checkout').set('Authorization', `Bearer ${tenantAdminToken}`).send({});
    delete process.env.SKIP_BILLING;
    expect(sandbox.body).toEqual({ sandbox: true });

    // Nothing to buy yet.
    const empty = await request(app).post('/api/tenants/me/cart/checkout').set('Authorization', `Bearer ${tenantAdminToken}`).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('CART_EMPTY');

    await holdOneMailbox();
    const started = await request(app).post('/api/tenants/me/cart/checkout').set('Authorization', `Bearer ${tenantAdminToken}`).send({});
    expect(started.status).toBe(200);
    expect(started.body.url).toBe('https://checkout.stripe.com/activation-session');
    expect(stripeClient.createActivationCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        trialDays: 60,
        lines: [expect.objectContaining({ name: 'Team — acme.com', unitAmountPaise: 100000, quantity: 1, domainId, planId })],
        successUrl: expect.stringContaining('/cart?checkout=success&session_id={CHECKOUT_SESSION_ID}'),
        metadata: expect.objectContaining({ tenantId, purpose: 'cart_activation' }),
      })
    );
  });

  it('a valid promo code lengthens the Stripe trial by its extra days', async () => {
    const { stripeClient } = await import('../src/stripe/client');
    const { CouponModel } = await import('../src/db/models');
    await CouponModel.create({ code: 'BONUS30', extraTrialDays: 30, maxUses: 5, usedCount: 0, status: 'active', redemptions: [] } as any);
    await holdOneMailbox();

    const started = await request(app).post('/api/tenants/me/cart/checkout').set('Authorization', `Bearer ${tenantAdminToken}`).send({ promoCode: 'bonus30' });
    expect(started.status).toBe(200);
    expect(stripeClient.createActivationCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ trialDays: 90 }));

    const bad = await request(app).post('/api/tenants/me/cart/checkout').set('Authorization', `Bearer ${tenantAdminToken}`).send({ promoCode: 'NOPE' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('INVALID_COUPON');
  });

  it('return trip: rejects a foreign/unfinished session; adopts the Stripe subscription (trial dates, card, per-domain rows) and releases held mailboxes', async () => {
    const { stripeClient } = await import('../src/stripe/client');
    await holdOneMailbox();
    const trialEnd = Math.floor(Date.now() / 1000) + 60 * 86400;

    vi.mocked(stripeClient.retrieveCheckoutSession).mockResolvedValueOnce({ metadata: { tenantId: 'someone-else', purpose: 'cart_activation' }, status: 'complete', subscription: 'sub_x' } as any);
    const foreign = await request(app).post('/api/tenants/me/cart/complete').set('Authorization', `Bearer ${tenantAdminToken}`).send({ sessionId: 'cs_foreign' });
    expect(foreign.status).toBe(403);

    vi.mocked(stripeClient.retrieveCheckoutSession).mockResolvedValueOnce({ metadata: { tenantId, purpose: 'cart_activation' }, status: 'open', subscription: null } as any);
    const open = await request(app).post('/api/tenants/me/cart/complete').set('Authorization', `Bearer ${tenantAdminToken}`).send({ sessionId: 'cs_open' });
    expect(open.status).toBe(402);
    expect((await TenantModel.findById(tenantId))!.trialStartedAt).toBeNull();

    vi.mocked(stripeClient.retrieveCheckoutSession).mockResolvedValue({ id: 'cs_ok', metadata: { tenantId, purpose: 'cart_activation' }, status: 'complete', subscription: 'sub_master' } as any);
    vi.mocked(stripeClient.retrieveSubscriptionExpanded).mockResolvedValue({
      id: 'sub_master',
      trial_start: trialEnd - 60 * 86400,
      trial_end: trialEnd,
      default_payment_method: { id: 'pm_real_1', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } },
      items: { data: [{ id: 'si_dom', price: { product: { metadata: { domainId, planId } } } }] },
    } as any);

    const done = await request(app).post('/api/tenants/me/cart/complete').set('Authorization', `Bearer ${tenantAdminToken}`).send({ sessionId: 'cs_ok' });
    expect(done.status).toBe(200);
    expect(done.body.activatedMailboxes).toBe(1);
    expect(done.body.cart.trial.started).toBe(true);

    const tenant = await TenantModel.findById(tenantId);
    expect(tenant!.stripeSubscriptionId).toBe('sub_master');
    expect(tenant!.trialEndsAt!.getTime()).toBe(trialEnd * 1000);
    expect(tenant!.paymentMethods?.[0]?.last4).toBe('4242');
    const sub = await DomainSubscriptionModel.findOne({ domainId });
    expect(sub).toMatchObject({ stripeSubscriptionId: 'sub_master', stripeSubscriptionItemId: 'si_dom', status: 'trialing' });
    expect((await MailboxModel.findOne({ address: 'held@acme.com' }))?.status).toBe('active');

    // Refreshing the return URL (or the webhook arriving second) changes nothing.
    const again = await request(app).post('/api/tenants/me/cart/complete').set('Authorization', `Bearer ${tenantAdminToken}`).send({ sessionId: 'cs_ok' });
    expect(again.status).toBe(200);
    expect(again.body.alreadyStarted).toBe(true);
    expect(vi.mocked(stripeClient.retrieveSubscriptionExpanded)).toHaveBeenCalledTimes(1);
  });

  it('checkout.session.completed webhook adopts the same way (whichever lands first wins)', async () => {
    const { stripeClient } = await import('../src/stripe/client');
    const { handleWebhookEvent } = await import('../src/services/billing.service');
    await holdOneMailbox();
    const trialEnd = Math.floor(Date.now() / 1000) + 60 * 86400;
    vi.mocked(stripeClient.retrieveSubscriptionExpanded).mockResolvedValue({
      id: 'sub_hook', trial_start: trialEnd - 60 * 86400, trial_end: trialEnd, default_payment_method: null,
      items: { data: [{ id: 'si_hook', price: { product: { metadata: { domainId, planId } } } }] },
    } as any);

    await handleWebhookEvent({
      id: 'evt_hook', type: 'checkout.session.completed',
      data: { object: { id: 'cs_hook', subscription: 'sub_hook', status: 'complete', metadata: { tenantId, purpose: 'cart_activation' } } },
    } as any);

    expect((await TenantModel.findById(tenantId))!.stripeSubscriptionId).toBe('sub_hook');
    expect((await MailboxModel.findOne({ address: 'held@acme.com' }))?.billingHold).toBe(false);
  });

  it('change card: hosted Stripe screen, then the new card becomes the default on the customer AND the subscription', async () => {
    const { stripeClient } = await import('../src/stripe/client');
    await TenantModel.updateOne({ _id: tenantId }, { trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 86400000), stripeSubscriptionId: 'sub_live' });

    const started = await request(app).post('/api/tenants/me/cart/card-update').set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(started.body.url).toBe('https://checkout.stripe.com/card-session');

    vi.mocked(stripeClient.retrieveCheckoutSession).mockResolvedValueOnce({
      metadata: { tenantId, purpose: 'card_update' }, status: 'complete',
      setup_intent: { payment_method: { id: 'pm_new', card: { brand: 'mastercard', last4: '1111', exp_month: 1, exp_year: 2031 } } },
    } as any);
    const done = await request(app).post('/api/tenants/me/cart/card-update/complete').set('Authorization', `Bearer ${tenantAdminToken}`).send({ sessionId: 'cs_card' });
    expect(done.status).toBe(200);
    expect(stripeClient.setDefaultPaymentMethod).toHaveBeenCalledWith('cus_test', 'pm_new');
    expect(stripeClient.setSubscriptionDefaultPaymentMethod).toHaveBeenCalledWith('sub_live', 'pm_new');
    expect((await TenantModel.findById(tenantId))!.paymentMethods?.some((m) => m.last4 === '1111' && m.isDefault)).toBe(true);
  });

  it('set default: the chosen card is the one the subscription charges, and the list shows it as default', async () => {
    const { stripeClient } = await import('../src/stripe/client');
    await TenantModel.updateOne(
      { _id: tenantId },
      {
        stripeCustomerId: 'cus_test',
        stripeSubscriptionId: 'sub_live',
        paymentMethods: [
          { id: 'pm_visa', brand: 'visa', last4: '4242', expMonth: 1, expYear: 2031, isDefault: false },
          { id: 'pm_mc', brand: 'mastercard', last4: '4444', expMonth: 1, expYear: 2031, isDefault: true },
        ],
      }
    );
    // Stripe lists the newest card first; the Checkout Visa is older than the Mastercard.
    vi.mocked(stripeClient.listPaymentMethods).mockResolvedValue([
      { id: 'pm_mc', card: { brand: 'mastercard', last4: '4444', exp_month: 1, exp_year: 2031 } },
      { id: 'pm_visa', card: { brand: 'visa', last4: '4242', exp_month: 1, exp_year: 2031 } },
    ] as any);

    const set = await request(app).post('/api/tenants/me/billing/payment-methods/pm_visa/default').set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(set.status).toBe(200);
    expect(stripeClient.setDefaultPaymentMethod).toHaveBeenCalledWith('cus_test', 'pm_visa');
    expect(stripeClient.setSubscriptionDefaultPaymentMethod).toHaveBeenCalledWith('sub_live', 'pm_visa');

    const list = await request(app).get('/api/tenants/me/billing/payment-methods').set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(list.body.defaultPaymentMethodId).toBe('pm_visa');
    expect(list.body.paymentMethods.find((m: any) => m.isDefault).id).toBe('pm_visa');
  });

  it('allows mailbox creation once the domain has a trialing subscription', async () => {
    await DomainSubscriptionModel.create({
      domainId,
      tenantId,
      planId,
      stripeSubscriptionId: 'sub_ok',
      stripeSubscriptionItemId: 'si_ok',
      status: 'trialing',
    });

    const { stalwartClient } = await import('../src/stalwart/client');
    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([{ id: 'stalwart-dom-1', name: 'acme.com' } as any]);
    vi.spyOn(stalwartClient, 'createAccount').mockResolvedValue({
      id: 'acc-1',
      name: 'alice',
      domainId: 'stalwart-dom-1',
      emailAddress: 'alice@acme.com',
    } as any);

    const res = await request(app)
      .post('/api/tenants/me/mailboxes')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ localPart: 'alice', password: 'Password123!', domainId });

    expect(res.status).toBe(201);
  });

  it('manages tenant payment methods and supports attaching to domain', async () => {
    // 1. List initially empty
    const listRes1 = await request(app)
      .get('/api/tenants/me/billing/payment-methods')
      .set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(listRes1.status).toBe(200);
    expect(listRes1.body.paymentMethods).toEqual([]);

    // 2. Save payment method
    const saveRes = await request(app)
      .post('/api/tenants/me/billing/payment-methods')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ brand: 'visa', last4: '4242', expMonth: 12, expYear: 2028 });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.success).toBe(true);
    expect(saveRes.body.paymentMethod.last4).toBe('4242');

    // 3. List contains saved payment method
    const listRes2 = await request(app)
      .get('/api/tenants/me/billing/payment-methods')
      .set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(listRes2.status).toBe(200);
    expect(listRes2.body.paymentMethods.length).toBe(1);
    expect(listRes2.body.paymentMethods[0].brand).toBe('visa');

    // 4. Setup intent endpoint
    const setupRes = await request(app)
      .post('/api/tenants/me/billing/setup-intent')
      .set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(setupRes.status).toBe(200);
    expect(setupRes.body.clientSecret).toBeDefined();

    // 5. Per-domain attach is sandbox-only — with Stripe the trial starts through checkout
    const attachRes = await request(app)
      .post(`/api/tenants/me/billing/domains/${domainId}/attach-payment`)
      .set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(attachRes.status).toBe(400);
    expect(attachRes.body.error).toBe('USE_CHECKOUT');

    // 6. Delete payment method
    const pmId = listRes2.body.paymentMethods[0].id;
    const delRes = await request(app)
      .delete(`/api/tenants/me/billing/payment-methods/${pmId}`)
      .set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);
  });

  it('scenario 4: second domain joins existing subscription via select-plan at its own rate, updating billing summary', async () => {
    const { stripeClient } = await import('../src/stripe/client');
    const trialEnd = new Date(Date.now() + 60 * 86400000);
    await TenantModel.updateOne(
      { _id: tenantId },
      {
        stripeCustomerId: 'cus_test',
        stripeSubscriptionId: 'sub_shared',
        trialStartedAt: new Date(),
        trialEndsAt: trialEnd,
      }
    );

    await PlanModel.updateOne({ _id: planId }, { name: 'Starter', monthlyPriceInPaise: 4900 });

    // Primary domain has an existing subscription item (Starter plan @ 4900 paise, 2 active users)
    await DomainSubscriptionModel.create({
      domainId,
      tenantId,
      planId,
      stripeSubscriptionId: 'sub_shared',
      stripeSubscriptionItemId: 'si_dom1',
      status: 'trialing',
      trialEnd,
      currentPeriodEnd: trialEnd,
      activeUserCount: 2,
      pricePerUserMonthlyPaise: 4900,
    });

    const proPlan = await PlanModel.create({
      name: 'Pro',
      seatCount: 50,
      monthlyPriceInPaise: 9900,
      billingMode: 'metered',
      isActive: true,
    });

    // Add a second domain
    const secondDomain = await DomainModel.create({
      tenantId,
      domainName: 'second.com',
      status: 'active',
      dnsStatus: 'active',
      isPrimary: false,
    });

    vi.mocked(stripeClient.addDomainSubscriptionItem).mockResolvedValueOnce({ id: 'si_dom2' } as any);

    // Second domain selects Pro plan
    const selectRes = await request(app)
      .post(`/api/tenants/me/billing/domains/${secondDomain._id}/select-plan`)
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ planId: proPlan._id.toString() });

    expect(selectRes.status).toBe(200);

    // Verify it called addDomainSubscriptionItem on the SAME subscription at Pro rate
    expect(stripeClient.addDomainSubscriptionItem).toHaveBeenCalledWith('sub_shared', {
      name: 'Pro — second.com',
      unitAmountPaise: 9900,
      quantity: 0,
      domainId: secondDomain._id.toString(),
      planId: proPlan._id.toString(),
    });

    // DomainSubscription for second domain created and rides the shared trial
    const sub2 = await DomainSubscriptionModel.findOne({ domainId: secondDomain._id });
    expect(sub2).toMatchObject({
      stripeSubscriptionId: 'sub_shared',
      stripeSubscriptionItemId: 'si_dom2',
      status: 'trialing',
      planId: proPlan._id,
      activeUserCount: 0,
    });

    // Billing summary shows both domains with their respective rates and active counts
    const summaryRes = await request(app)
      .get('/api/tenants/me/billing/summary')
      .set('Authorization', `Bearer ${tenantAdminToken}`);

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.domains).toHaveLength(2);
    expect(summaryRes.body.domains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domainName: 'acme.com',
          planName: 'Starter',
          activeUserCount: 2,
          pricePerUserMonthlyPaise: 4900,
          monthlySubtotalPaise: 9800,
        }),
        expect.objectContaining({
          domainName: 'second.com',
          planName: 'Pro',
          activeUserCount: 0,
          pricePerUserMonthlyPaise: 9900,
          monthlySubtotalPaise: 0,
        }),
      ])
    );
  });

  it('scenario 4: creating a domain with planId joins existing subscription immediately', async () => {
    const { stripeClient } = await import('../src/stripe/client');
    const trialEnd = new Date(Date.now() + 60 * 86400000);
    await TenantModel.updateOne(
      { _id: tenantId },
      {
        stripeCustomerId: 'cus_test',
        stripeSubscriptionId: 'sub_shared',
        trialStartedAt: new Date(),
        trialEndsAt: trialEnd,
      }
    );

    const proPlan = await PlanModel.create({
      name: 'Pro',
      seatCount: 50,
      monthlyPriceInPaise: 9900,
      billingMode: 'metered',
      isActive: true,
    });

    vi.mocked(stripeClient.addDomainSubscriptionItem).mockResolvedValueOnce({ id: 'si_dom_direct' } as any);

    const res = await request(app)
      .post('/api/tenants/me/domains')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ domainName: 'direct-with-plan.com', planId: proPlan._id.toString() });

    expect(res.status).toBe(201);
    expect(stripeClient.addDomainSubscriptionItem).toHaveBeenCalledWith('sub_shared', expect.objectContaining({
      name: 'Pro — direct-with-plan.com',
      unitAmountPaise: 9900,
      planId: proPlan._id.toString(),
    }));

    const directSub = await DomainSubscriptionModel.findOne({ stripeSubscriptionItemId: 'si_dom_direct' });
    expect(directSub).not.toBeNull();
    expect(directSub?.stripeSubscriptionId).toBe('sub_shared');
  });

  it('scenario 3: adding and suspending mailboxes updates Active User count and syncs quantity to Stripe', async () => {
    const { stripeClient } = await import('../src/stripe/client');
    const { syncDomainActiveUserCount } = await import('../src/services/billing.service');

    const starterPlan = await PlanModel.create({
      name: 'Starter Active',
      seatCount: 10,
      monthlyPriceInPaise: 4900,
      billingMode: 'metered',
      isActive: true,
    });

    const domain = await DomainModel.create({
      tenantId,
      domainName: 'activeusers.com',
      status: 'active',
      planId: starterPlan._id,
      planName: 'Starter Active',
      mailboxLimit: 10,
    });

    const sub = await DomainSubscriptionModel.create({
      tenantId,
      domainId: domain._id,
      planId: starterPlan._id,
      stripeSubscriptionId: 'sub_scenario3',
      stripeSubscriptionItemId: 'si_scenario3',
      status: 'active',
      activeUserCount: 1,
      maxUsers: 10,
      pricePerUserMonthlyPaise: 4900,
      cancelAtPeriodEnd: false,
    });

    await MailboxModel.create({
      tenantId,
      domainId: domain._id,
      localPart: 'user1',
      address: 'user1@activeusers.com',
      status: 'active',
      billingHold: false,
    });

    const mb2 = await MailboxModel.create({
      tenantId,
      domainId: domain._id,
      localPart: 'user2',
      address: 'user2@activeusers.com',
      status: 'active',
      billingHold: false,
    });

    vi.mocked(stripeClient.syncDomainUserQuantity).mockClear();
    await syncDomainActiveUserCount(domain._id.toString());

    expect(stripeClient.syncDomainUserQuantity).toHaveBeenCalledWith('si_scenario3', 2);
    let subDoc = await DomainSubscriptionModel.findById(sub._id);
    expect(subDoc?.activeUserCount).toBe(2);

    let summaryRes = await request(app)
      .get('/api/tenants/me/billing/summary')
      .set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(summaryRes.status).toBe(200);
    const domainSummary = summaryRes.body.domains.find((d: any) => d.domainId === domain._id.toString());
    expect(domainSummary).toMatchObject({
      activeUserCount: 2,
      maxUsers: 10,
      pricePerUserMonthlyPaise: 4900,
      monthlySubtotalPaise: 9800,
    });

    // Suspend Mailbox 2
    mb2.status = 'suspended';
    await mb2.save();

    vi.mocked(stripeClient.syncDomainUserQuantity).mockClear();
    await syncDomainActiveUserCount(domain._id.toString());

    expect(stripeClient.syncDomainUserQuantity).toHaveBeenCalledWith('si_scenario3', 1);
    subDoc = await DomainSubscriptionModel.findById(sub._id);
    expect(subDoc?.activeUserCount).toBe(1);

    summaryRes = await request(app)
      .get('/api/tenants/me/billing/summary')
      .set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(summaryRes.status).toBe(200);
    const updatedSummary = summaryRes.body.domains.find((d: any) => d.domainId === domain._id.toString());
    expect(updatedSummary).toMatchObject({
      activeUserCount: 1,
      monthlySubtotalPaise: 4900,
    });
  });

  it('scenario 5: upgrade changes item price in Stripe and summary; downgrade below active users is refused', async () => {
    const { stripeClient } = await import('../src/stripe/client');
    const { handleWebhookEvent } = await import('../src/services/billing.service');

    const starterPlan = await PlanModel.create({
      name: 'Starter Tier',
      seatCount: 10,
      monthlyPriceInPaise: 4900,
      billingMode: 'metered',
      isActive: true,
    });
    const proPlan = await PlanModel.create({
      name: 'Pro Tier',
      seatCount: 50,
      monthlyPriceInPaise: 9900,
      billingMode: 'metered',
      isActive: true,
    });
    const soloPlan = await PlanModel.create({
      name: 'Solo Tier',
      seatCount: 1,
      monthlyPriceInPaise: 2900,
      billingMode: 'metered',
      isActive: true,
    });

    const domain = await DomainModel.create({
      tenantId,
      domainName: 'planchange.com',
      status: 'active',
      planId: starterPlan._id,
      planName: 'Starter Tier',
      mailboxLimit: 10,
    });

    const sub = await DomainSubscriptionModel.create({
      tenantId,
      domainId: domain._id,
      planId: starterPlan._id,
      stripeSubscriptionId: 'sub_planchange',
      stripeSubscriptionItemId: 'si_planchange',
      status: 'active',
      activeUserCount: 1,
      maxUsers: 10,
      pricePerUserMonthlyPaise: 4900,
      cancelAtPeriodEnd: false,
    });

    await MailboxModel.create({
      tenantId,
      domainId: domain._id,
      localPart: 'user1',
      address: 'user1@planchange.com',
      status: 'active',
      billingHold: false,
    });

    vi.mocked(stripeClient.getOrCreatePrice).mockImplementation(async (plan: any) => `price_${plan.name.replace(/\s+/g, '_').toLowerCase()}`);
    vi.mocked(stripeClient.updateSubscriptionItemPrice).mockClear();

    // 1. Upgrade to Pro
    const upgradeRes = await request(app)
      .post(`/api/tenants/me/billing/domains/${domain._id}/upgrade`)
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ planId: proPlan._id.toString() });

    expect(upgradeRes.status).toBe(200);
    expect(stripeClient.updateSubscriptionItemPrice).toHaveBeenCalledWith(
      'sub_planchange',
      'si_planchange',
      'price_pro_tier',
      1
    );

    let updatedDomain = await DomainModel.findById(domain._id);
    expect(updatedDomain?.planName).toBe('Pro Tier');
    expect(updatedDomain?.mailboxLimit).toBe(50);

    let updatedSub = await DomainSubscriptionModel.findById(sub._id);
    expect(updatedSub?.pricePerUserMonthlyPaise).toBe(9900);
    expect(updatedSub?.maxUsers).toBe(50);

    // 2. Add another active mailbox so activeUserCount = 2
    await MailboxModel.create({
      tenantId,
      domainId: domain._id,
      localPart: 'user2',
      address: 'user2@planchange.com',
      status: 'active',
      billingHold: false,
    });
    updatedSub!.activeUserCount = 2;
    await updatedSub!.save();

    // 3. Attempt to downgrade to Solo (ceiling = 1) with 2 active mailboxes -> refused with 400
    vi.mocked(stripeClient.scheduleDowngrade).mockClear();
    const badDowngradeRes = await request(app)
      .post(`/api/tenants/me/billing/domains/${domain._id}/downgrade`)
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ planId: soloPlan._id.toString() });

    expect(badDowngradeRes.status).toBe(400);
    expect(badDowngradeRes.body.error).toBe('ACTIVE_USERS_EXCEED_PLAN_LIMIT');
    expect(badDowngradeRes.body.message).toContain('exceeds the plan limit of 1');
    expect(stripeClient.scheduleDowngrade).not.toHaveBeenCalled();

    // 4. Downgrade to Starter (ceiling = 10, current users = 2) -> succeeds and schedules downgrade
    const goodDowngradeRes = await request(app)
      .post(`/api/tenants/me/billing/domains/${domain._id}/downgrade`)
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ planId: starterPlan._id.toString() });

    expect(goodDowngradeRes.status).toBe(200);
    expect(stripeClient.scheduleDowngrade).toHaveBeenCalledWith(
      'sub_planchange',
      'price_starter_tier',
      2
    );

    updatedSub = await DomainSubscriptionModel.findById(sub._id);
    expect(updatedSub?.pendingDowngradePlanId?.toString()).toBe(starterPlan._id.toString());
    // Mailbox limit remains Pro limit (50) until period end renewal
    updatedDomain = await DomainModel.findById(domain._id);
    expect(updatedDomain?.mailboxLimit).toBe(50);

    // 5. Renewal webhook applies pending downgrade
    await handleWebhookEvent({
      id: 'evt_renewal_cycle',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_renewal_123',
          subscription: 'sub_planchange',
          billing_reason: 'subscription_cycle',
        } as any,
      },
    } as any);

    updatedSub = await DomainSubscriptionModel.findById(sub._id);
    expect(updatedSub?.pendingDowngradePlanId).toBeNull();
    expect(updatedSub?.planId?.toString()).toBe(starterPlan._id.toString());
    expect(updatedSub?.pricePerUserMonthlyPaise).toBe(4900);
    expect(updatedSub?.maxUsers).toBe(10);

    updatedDomain = await DomainModel.findById(domain._id);
    expect(updatedDomain?.planId?.toString()).toBe(starterPlan._id.toString());
    expect(updatedDomain?.planName).toBe('Starter Tier');
    expect(updatedDomain?.mailboxLimit).toBe(10);
  });
});
