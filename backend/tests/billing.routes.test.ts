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

  it('blocks the first mailbox with 402 when the domain has no subscription', async () => {
    // domainId (from the shared beforeEach) has a plan but no DomainSubscription yet.
    const res = await request(app)
      .post('/api/tenants/me/mailboxes')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ localPart: 'blocked', password: 'Password123!', domainId });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('PAYMENT_REQUIRED');
  });

  it('allows mailbox creation without subscription when SKIP_BILLING is true', async () => {
    process.env.SKIP_BILLING = 'true';
    try {
      const { stalwartClient } = await import('../src/stalwart/client');
      vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([{ id: 'stalwart-dom-1', name: 'acme.com' } as any]);
      vi.spyOn(stalwartClient, 'createAccount').mockResolvedValue({
        id: 'acc-skip-bill',
        name: 'freeuser',
        domainId: 'stalwart-dom-1',
        emailAddress: 'freeuser@acme.com',
      } as any);

      const res = await request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ localPart: 'freeuser', password: 'Password123!', domainId });

      expect(res.status).toBe(201);
      expect(res.body.address).toBe('freeuser@acme.com');
    } finally {
      delete process.env.SKIP_BILLING;
    }
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

    // 5. Attach payment to domain starts trialing subscription
    const attachRes = await request(app)
      .post(`/api/tenants/me/billing/domains/${domainId}/attach-payment`)
      .set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(attachRes.status).toBe(200);
    expect(attachRes.body.success).toBe(true);
    expect(attachRes.body.status).toBe('trialing');

    // 6. Delete payment method
    const pmId = listRes2.body.paymentMethods[0].id;
    const delRes = await request(app)
      .delete(`/api/tenants/me/billing/payment-methods/${pmId}`)
      .set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);
  });
});
