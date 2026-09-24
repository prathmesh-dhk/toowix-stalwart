import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../src/app';
import { AdminUserModel } from '../src/db/models/AdminUser';
import { TenantModel } from '../src/db/models/Tenant';
import { DomainModel } from '../src/db/models/Domain';
import { PlanModel } from '../src/db/models/Plan';
import { DomainSubscriptionModel } from '../src/db/models/DomainSubscription';
import { MailboxModel } from '../src/db/models/Mailbox';
import { generateOidcToken } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';

describe('Multi-Domain & Domain Scoping API Tests', () => {
  let mongod: MongoMemoryServer;
  let tenantId: string;
  let adminToken: string;
  let plan10Id: string;
  let plan25Id: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);

    vi.spyOn(stalwartClient, 'createDomain').mockImplementation(async (name) => ({
      id: `stalwart-dom-${name}`,
      name,
    }));
    vi.spyOn(stalwartClient, 'createAccount').mockResolvedValue('stalwart-acc-id');
    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([]);
    vi.spyOn(stalwartClient, 'updateDomainStatus').mockResolvedValue();
    vi.spyOn(stalwartClient, 'getActiveDkimKeys').mockResolvedValue([]);
    // Stub the retrying wrapper directly too — an always-empty getActiveDkimKeys
    // mock would otherwise make every domain creation actually sleep through
    // all of getActiveDkimKeysWithRetry's real retry delays.
    vi.spyOn(stalwartClient, 'getActiveDkimKeysWithRetry').mockResolvedValue([]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await AdminUserModel.deleteMany({});
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await MailboxModel.deleteMany({});
    await PlanModel.deleteMany({});
    await DomainSubscriptionModel.deleteMany({});

    const plan10 = await PlanModel.create({ name: 'Team', seatCount: 10, displayOrder: 1, isActive: true });
    const plan25 = await PlanModel.create({ name: 'Growth', seatCount: 25, displayOrder: 2, isActive: true });
    plan10Id = plan10._id.toString();
    plan25Id = plan25._id.toString();

    const tenant = await TenantModel.create({
      name: 'Acme Multi-Org',
      contactEmail: 'admin@acme.org',
      status: 'active',
      mailboxLimit: 50,
      mailboxCount: 0,
    });
    tenantId = tenant._id.toString();

    const admin = await AdminUserModel.create({
      email: 'admin@acme.org',
      passwordHash: 'dummyhash',
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
      status: 'active',
      twoFactorEnabled: false,
    });

    adminToken = generateOidcToken({
      id: admin._id.toString(),
      email: admin.email,
      role: 'TENANT_ADMIN',
      tenantId,
      twoFactorEnabled: false,
    });
  });

  describe('GET /api/tenants/me/domains/check-availability', () => {
    it('reports a domain available when nothing owns it yet', async () => {
      const res = await request(app)
        .get('/api/tenants/me/domains/check-availability?domain=freshbrand.com')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(true);
    });

    it('reports a domain unavailable once claimed, catching it before domain creation is even attempted', async () => {
      await request(app)
        .post('/api/tenants/me/domains')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ domainName: 'takenbrand.com', planId: plan10Id });

      const res = await request(app)
        .get('/api/tenants/me/domains/check-availability?domain=takenbrand.com')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(false);
      // Claimed by the caller's own tenant — the wizard must not treat that as "someone else has it".
      expect(res.body.ownedByYou).toBe(true);

      // Case-insensitive, matching the same normalization domain creation uses.
      const resUpper = await request(app)
        .get('/api/tenants/me/domains/check-availability?domain=TakenBrand.com')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(resUpper.body.available).toBe(false);
    });

    it('tells apart a domain another organization owns from one you already added', async () => {
      const other = await TenantModel.create({ name: 'Rival Inc', contactEmail: 'x@rival.com', status: 'active', mailboxLimit: 5, mailboxCount: 0 });
      await DomainModel.create({ tenantId: other._id, domainName: 'rivalbrand.com', status: 'active', dnsStatus: 'active', isPrimary: true });

      const res = await request(app)
        .get('/api/tenants/me/domains/check-availability?domain=rivalbrand.com')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.body).toMatchObject({ available: false, ownedByYou: false });

      const free = await request(app)
        .get('/api/tenants/me/domains/check-availability?domain=freshbrand.com')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(free.body).toMatchObject({ available: true, ownedByYou: false });
    });

    it('rejects a malformed domain name', async () => {
      const res = await request(app)
        .get('/api/tenants/me/domains/check-availability?domain=not a domain')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_DOMAIN');
    });
  });

  it('allows a tenant to create multiple domains with employee tiers', async () => {
    // 1. Add first domain with 10 employees
    const res1 = await request(app)
      .post('/api/tenants/me/domains')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        domainName: 'primarybrand.com',
        planId: plan10Id,
      });

    expect(res1.status).toBe(201);
    expect(res1.body.success).toBe(true);
    expect(res1.body.domain.domainName).toBe('primarybrand.com');
    expect(res1.body.domain.mailboxLimit).toBe(10);
    expect(res1.body.domain.isPrimary).toBe(true);
    // Domain is pre-created in Stalwart (kept disabled) and DNS records/zone file are generated immediately
    expect(res1.body.domain.stalwartDomainId).toBe('stalwart-dom-primarybrand.com');
    expect(res1.body.domain.dnsStatus).toBe('not_started');
    expect(Array.isArray(res1.body.domain.dnsRecords)).toBe(true);
    expect(res1.body.domain.dnsRecords.length).toBeGreaterThan(0);
    expect(res1.body.domain.dnsZoneFile).toContain('primarybrand.com');

    // 2. Add second domain with 25 employees (multi-domain)
    const res2 = await request(app)
      .post('/api/tenants/me/domains')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        domainName: 'subsidiary.org',
        planId: plan25Id,
      });

    expect(res2.status).toBe(201);
    expect(res2.body.success).toBe(true);
    expect(res2.body.domain.domainName).toBe('subsidiary.org');
    expect(res2.body.domain.mailboxLimit).toBe(25);
    expect(res2.body.domain.isPrimary).toBe(false);

    // 3. List domains
    const listRes = await request(app)
      .get('/api/tenants/me/domains')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.domains).toHaveLength(2);
    expect(listRes.body.domains[0].domainName).toBe('primarybrand.com');
    expect(listRes.body.domains[1].domainName).toBe('subsidiary.org');
    // dnsStatus must be present here — the tenant-admin UI gates mailbox
    // creation on it (a domain fetched via this list without it looks
    // permanently "pending activation" even once DNS is actually verified).
    expect(listRes.body.domains[0].dnsStatus).toBe('not_started');
    expect(listRes.body.domains[1].dnsStatus).toBe('not_started');

    // 4. Verify /api/tenants/me returns domains array
    const meRes = await request(app)
      .get('/api/tenants/me')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.tenant.domains).toHaveLength(2);
    expect(meRes.body.tenant.domain.domainName).toBe('primarybrand.com');
  });

  describe('creating a domain without a plan, then selecting one later', () => {
    it('creates the domain with no plan when planId is omitted (wizard now asks for a plan only after DNS setup)', async () => {
      const res = await request(app)
        .post('/api/tenants/me/domains')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ domainName: 'planless.com' });

      expect(res.status).toBe(201);
      expect(res.body.domain.planId).toBeNull();
      expect(res.body.domain.planName).toBeNull();

      const stored = await DomainModel.findOne({ domainName: 'planless.com' });
      expect(stored?.planId).toBeNull();
    });

    it('rejects an invalid planId at creation the same way as before, but still allows omitting it', async () => {
      const res = await request(app)
        .post('/api/tenants/me/domains')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ domainName: 'badplan.com', planId: 'not-an-object-id' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_PLAN_ID');
    });

    it('POST /api/tenants/me/billing/domains/:id/select-plan attaches a plan to a plan-less domain', async () => {
      const createRes = await request(app)
        .post('/api/tenants/me/domains')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ domainName: 'pickaplan.com' });
      const domainId = createRes.body.domain.id;

      const selectRes = await request(app)
        .post(`/api/tenants/me/billing/domains/${domainId}/select-plan`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ planId: plan25Id });

      expect(selectRes.status).toBe(200);
      expect(selectRes.body.domain).toMatchObject({
        id: domainId,
        mailboxLimit: 25,
        employeeCount: 25,
        planId: plan25Id,
        planName: 'Growth',
      });

      const stored = await DomainModel.findById(domainId);
      expect(stored?.mailboxLimit).toBe(25);
      expect(stored?.planId?.toString()).toBe(plan25Id);
    });

    it('rejects select-plan for a domain that already has a live subscription — use upgrade/downgrade instead', async () => {
      const createRes = await request(app)
        .post('/api/tenants/me/domains')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ domainName: 'already-subscribed.com' });
      const domainId = createRes.body.domain.id;

      await DomainSubscriptionModel.create({
        domainId,
        tenantId,
        planId: plan10Id,
        stripeSubscriptionId: 'sub_existing',
        stripeSubscriptionItemId: 'si_existing',
        status: 'active',
      });

      const selectRes = await request(app)
        .post(`/api/tenants/me/billing/domains/${domainId}/select-plan`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ planId: plan25Id });

      expect(selectRes.status).toBe(409);
      expect(selectRes.body.error).toBe('PLAN_ALREADY_SELECTED');
    });

    it('select-plan does NOT auto-activate — mailboxes are created on billing hold until payment is confirmed', async () => {
      const prevSkip = process.env.SKIP_BILLING;
      process.env.SKIP_BILLING = 'true';
      try {
        const createRes = await request(app)
          .post('/api/tenants/me/domains')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ domainName: 'freeplan.com' });
        const domainId = createRes.body.domain.id;
        await DomainModel.updateOne({ _id: domainId }, { dnsStatus: 'active' });

        const selectRes = await request(app)
          .post(`/api/tenants/me/billing/domains/${domainId}/select-plan`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ planId: plan10Id });
        expect(selectRes.status).toBe(200);

        // No subscription yet — plan selection alone must not activate anything.
        const subBeforePayment = await DomainSubscriptionModel.findOne({ domainId });
        expect(subBeforePayment).toBeNull();

        // Creating a user before payment works, but the mailbox is held (suspended) until activation.
        const heldRes = await request(app)
          .post('/api/tenants/me/mailboxes')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ localPart: 'dave', password: 'Password123!', domainId });
        expect(heldRes.status).toBe(201);
        expect(heldRes.body.status).toBe('suspended');
        expect(heldRes.body.billingHold).toBe(true);

        // Simulate the "Cart" flow: the tenant adds a payment method, which attaches and
        // activates the domain (mirrors PaymentMethodSelector's saved/sandbox-card path).
        const attachRes = await request(app)
          .post(`/api/tenants/me/billing/domains/${domainId}/attach-payment`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(attachRes.status).toBe(200);

        const sub = await DomainSubscriptionModel.findOne({ domainId });
        expect(sub?.status).toBe('trialing');
        const released = await MailboxModel.findOne({ address: 'dave@freeplan.com' });
        expect(released?.status).toBe('active');
        expect(released?.billingHold).toBe(false);

        const mailboxRes = await request(app)
          .post('/api/tenants/me/mailboxes')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ localPart: 'carol', password: 'Password123!', domainId });
        expect(mailboxRes.status).toBe(201);
        expect(mailboxRes.body.status).toBe('active');
      } finally {
        if (prevSkip === undefined) delete process.env.SKIP_BILLING;
        else process.env.SKIP_BILLING = prevSkip;
      }
    });
  });

  it('provisions mailboxes under specified domain and supports domain filtering', async () => {
    // Create two domains
    const d1 = await DomainModel.create({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      domainName: 'alpha.io',
      mailboxLimit: 10,
      status: 'active',
      dnsStatus: 'active',
      isPrimary: true,
    });

    const d2 = await DomainModel.create({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      domainName: 'beta.io',
      mailboxLimit: 10,
      status: 'active',
      dnsStatus: 'active',
      isPrimary: false,
    });

    for (const d of [d1, d2]) {
      await DomainSubscriptionModel.create({
        domainId: d._id,
        tenantId,
        planId: plan10Id,
        stripeSubscriptionId: `test-sub-${d.domainName}`,
        stripeSubscriptionItemId: `test-item-${d.domainName}`,
        status: 'trialing',
      });
    }

    // Create mailbox under d1
    const mb1Res = await request(app)
      .post('/api/tenants/me/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        localPart: 'alice',
        password: 'Password123!',
        domainId: d1._id.toString(),
      });
    expect(mb1Res.status).toBe(201);
    expect(mb1Res.body.address).toBe('alice@alpha.io');

    // Create mailbox under d2
    const mb2Res = await request(app)
      .post('/api/tenants/me/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        localPart: 'bob',
        password: 'Password123!',
        domainId: d2._id.toString(),
      });
    expect(mb2Res.status).toBe(201);
    expect(mb2Res.body.address).toBe('bob@beta.io');

    // Filter by d1
    const d1List = await request(app)
      .get(`/api/tenants/me/mailboxes?domainId=${d1._id.toString()}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(d1List.status).toBe(200);
    expect(d1List.body.mailboxes).toHaveLength(1);
    expect(d1List.body.mailboxes[0].address).toBe('alice@alpha.io');

    // Filter by d2
    const d2List = await request(app)
      .get(`/api/tenants/me/mailboxes?domainId=${d2._id.toString()}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(d2List.status).toBe(200);
    expect(d2List.body.mailboxes).toHaveLength(1);
    expect(d2List.body.mailboxes[0].address).toBe('bob@beta.io');

    // All mailboxes
    const allList = await request(app)
      .get('/api/tenants/me/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(allList.status).toBe(200);
    expect(allList.body.mailboxes).toHaveLength(2);
  });

  it('enforces domain-level mailbox limit tier', async () => {
    // Create domain with limit 1
    const d = await DomainModel.create({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      domainName: 'singletier.com',
      mailboxLimit: 1,
      status: 'active',
      dnsStatus: 'active',
      isPrimary: true,
    });
    await DomainSubscriptionModel.create({
      domainId: d._id,
      tenantId,
      planId: plan10Id,
      stripeSubscriptionId: 'test-sub-singletier',
      stripeSubscriptionItemId: 'test-item-singletier',
      status: 'trialing',
    });

    // 1st mailbox succeeds
    const mb1 = await request(app)
      .post('/api/tenants/me/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        localPart: 'ceo',
        password: 'Password123!',
        domainId: d._id.toString(),
      });
    expect(mb1.status).toBe(201);

    // 2nd mailbox should fail with DOMAIN_QUOTA_EXCEEDED
    const mb2 = await request(app)
      .post('/api/tenants/me/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        localPart: 'cto',
        password: 'Password123!',
        domainId: d._id.toString(),
      });
    expect(mb2.status).toBe(409);
    expect(mb2.body.error).toBe('DOMAIN_QUOTA_EXCEEDED');
  });
});
