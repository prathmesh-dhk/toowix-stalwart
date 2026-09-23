import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { AdminUserModel, TenantModel, DomainModel, PlanModel, DomainSubscriptionModel, CouponModel } from '../src/db/models';
import { generateOidcToken } from '../src/auth/service';
import { couponService } from '../src/services/coupon.service';

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

describe('Coupon routes & one-time redemption system', () => {
  let superAdminToken: string;
  let tenantAdminToken: string;
  let tenantId: string;
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
    await CouponModel.deleteMany({});

    // Create super admin
    const superAdmin = await AdminUserModel.create({
      email: 'superadmin@toowix.com',
      passwordHash: 'hash',
      role: 'SUPER_ADMIN',
    });
    superAdminToken = generateOidcToken({
      id: superAdmin._id.toString(),
      email: superAdmin.email,
      role: 'SUPER_ADMIN',
    });

    // Create tenant and tenant admin
    const tenant = await TenantModel.create({ name: 'Acme Corp', status: 'active', mailboxLimit: 50, mailboxCount: 0 });
    tenantId = tenant._id.toString();

    const plan = await PlanModel.create({ name: 'Starter', seatCount: 10, displayOrder: 1, isActive: true, monthlyPriceInPaise: 4900 });
    const domain = await DomainModel.create({
      tenantId,
      domainName: 'acme.com',
      planId: plan._id.toString(),
      status: 'active',
      dnsStatus: 'active',
    });
    domainId = domain._id.toString();

    // Create initial subscription with 60-day trial
    const initialTrialEnd = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    await DomainSubscriptionModel.create({
      domainId: domain._id,
      tenantId: tenant._id,
      planId: plan._id.toString(),
      status: 'trialing',
      stripeSubscriptionId: 'sub_test_123',
      stripeSubscriptionItemId: 'si_test_123',
      trialEnd: initialTrialEnd,
      currentPeriodEnd: initialTrialEnd,
    });

    const tenantAdmin = await AdminUserModel.create({
      email: 'admin@acme.com',
      passwordHash: 'hash',
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
    });
    tenantAdminToken = generateOidcToken({
      id: tenantAdmin._id.toString(),
      email: tenantAdmin.email,
      role: 'TENANT_ADMIN',
      tenantId,
    });
  });

  describe('Super Admin Coupon API (/api/admin/coupons)', () => {
    it('rejects unauthenticated requests or non-super-admins with 401/403', async () => {
      const res1 = await request(app).get('/api/admin/coupons');
      expect(res1.status).toBe(401);

      const res2 = await request(app)
        .get('/api/admin/coupons')
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(res2.status).toBe(403);
    });

    it('creates a single one-time coupon with custom code and trial extension', async () => {
      const res = await request(app)
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          code: 'PROMO60',
          extraTrialDays: 60,
          description: 'Special 60-day trial extension',
        });

      expect(res.status).toBe(201);
      expect(res.body.coupon.code).toBe('PROMO60');
      expect(res.body.coupon.extraTrialDays).toBe(60);
      expect(res.body.coupon.maxUses).toBe(1);
      expect(res.body.coupon.usedCount).toBe(0);
      expect(res.body.coupon.status).toBe('active');
    });

    it('batch generates coupons with the configured redemption limit', async () => {
      const res = await request(app)
        .post('/api/admin/coupons/batch')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          count: 5,
          prefix: 'SUMMER',
          extraTrialDays: 30,
          maxUses: 25,
          description: 'Summer partner campaign',
        });

      expect(res.status).toBe(201);
      expect(res.body.count).toBe(5);
      expect(res.body.coupons).toHaveLength(5);
      for (const coupon of res.body.coupons) {
        expect(coupon.code.startsWith('SUMMER-')).toBe(true);
        expect(coupon.maxUses).toBe(25);
        expect(coupon.extraTrialDays).toBe(30);
      }
    });

    it('lists coupons with search and status filtering', async () => {
      await request(app)
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ code: 'ALPHA100', extraTrialDays: 100, description: 'VIP client' });

      await request(app)
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ code: 'BETA50', extraTrialDays: 50 });

      const listRes = await request(app)
        .get('/api/admin/coupons?search=ALPHA')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.coupons).toHaveLength(1);
      expect(listRes.body.coupons[0].code).toBe('ALPHA100');
    });

    it('revokes an active coupon and deletes an unused coupon', async () => {
      const createRes = await request(app)
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ code: 'REVOKE-ME', extraTrialDays: 45 });

      const couponId = createRes.body.coupon._id || createRes.body.coupon.id;

      const revokeRes = await request(app)
        .patch(`/api/admin/coupons/${couponId}/revoke`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(revokeRes.status).toBe(200);

      const updated = await CouponModel.findById(couponId);
      expect(updated?.status).toBe('revoked');

      const deleteRes = await request(app)
        .delete(`/api/admin/coupons/${couponId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(deleteRes.status).toBe(200);

      const deleted = await CouponModel.findById(couponId);
      expect(deleted).toBeNull();
    });
  });

  describe('Tenant Coupon Validation & Redemption (/api/tenants/me/billing)', () => {
    it('validates an active coupon successfully', async () => {
      await request(app)
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ code: 'SAVE30', extraTrialDays: 30, description: '+30 Days Trial' });

      const res = await request(app)
        .post('/api/tenants/me/billing/validate-coupon')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ code: 'save30' }); // case-insensitive

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.code).toBe('SAVE30');
      expect(res.body.extraTrialDays).toBe(30);
    });

    it('returns 400 when validating an invalid or nonexistent coupon', async () => {
      const res = await request(app)
        .post('/api/tenants/me/billing/validate-coupon')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ code: 'NONEXISTENT' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_COUPON');
    });

    it('redeems a one-time coupon, extends the subscription trial end, and prevents second use', async () => {
      await request(app)
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ code: 'ONETIME60', extraTrialDays: 60 });

      // First redemption: success
      const redeemRes1 = await request(app)
        .post('/api/tenants/me/billing/redeem-coupon')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ code: 'ONETIME60', domainId });

      expect(redeemRes1.status).toBe(200);
      expect(redeemRes1.body.success).toBe(true);
      expect(redeemRes1.body.newTrialEnd).toBeDefined();

      // Verify coupon is marked as used in DB
      const couponInDb = await CouponModel.findOne({ code: 'ONETIME60' });
      expect(couponInDb?.status).toBe('used');
      expect(couponInDb?.usedCount).toBe(1);
      expect(couponInDb?.redemptions).toHaveLength(1);

      // Verify domain subscription trialEnd was extended
      const subInDb = await DomainSubscriptionModel.findOne({ domainId });
      expect(new Date(subInDb!.trialEnd!).getTime()).toBeGreaterThan(Date.now() + 100 * 24 * 60 * 60 * 1000);

      // Second redemption attempt: must be rejected
      const redeemRes2 = await request(app)
        .post('/api/tenants/me/billing/redeem-coupon')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ code: 'ONETIME60', domainId });

      expect(redeemRes2.status).toBe(400);
      expect(redeemRes2.body.error).toBe('REDEEM_COUPON_FAILED');
    });

    it('allows the configured number of organizations to redeem a multi-use coupon', async () => {
      await request(app)
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ code: 'TEAM3', extraTrialDays: 10, maxUses: 3 });

      const tenant2 = await TenantModel.create({ name: 'Tenant Two', contactEmail: 'two@example.test', status: 'active' });
      const domain2 = await DomainModel.create({ tenantId: tenant2._id, domainName: 'two.example.test', status: 'active' });
      const tenant3 = await TenantModel.create({ name: 'Tenant Three', contactEmail: 'three@example.test', status: 'active' });
      const domain3 = await DomainModel.create({ tenantId: tenant3._id, domainName: 'three.example.test', status: 'active' });
      const tenant4 = await TenantModel.create({ name: 'Tenant Four', contactEmail: 'four@example.test', status: 'active' });
      const domain4 = await DomainModel.create({ tenantId: tenant4._id, domainName: 'four.example.test', status: 'active' });

      const redeemFor = async (id: string, domain: string) => couponService.redeemCoupon('TEAM3', id, domain);
      await expect(redeemFor(tenantId, domainId)).resolves.toMatchObject({ success: true });
      await expect(redeemFor(tenant2._id.toString(), domain2._id.toString())).resolves.toMatchObject({ success: true });
      await expect(redeemFor(tenant3._id.toString(), domain3._id.toString())).resolves.toMatchObject({ success: true });
      await expect(redeemFor(tenant4._id.toString(), domain4._id.toString())).rejects.toThrow(/redemption limit/i);

      const coupon = await CouponModel.findOne({ code: 'TEAM3' });
      expect(coupon?.usedCount).toBe(3);
      expect(coupon?.status).toBe('used');
    });

    it('rejects redemption of an expired coupon', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await CouponModel.create({
        code: 'EXPIRED10',
        extraTrialDays: 10,
        expiresAt: yesterday,
        maxUses: 1,
        usedCount: 0,
        status: 'active',
      });

      const res = await request(app)
        .post('/api/tenants/me/billing/redeem-coupon')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ code: 'EXPIRED10' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('REDEEM_COUPON_FAILED');
    });
  });
});
