import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../src/app';
import { AdminUserModel } from '../src/db/models/AdminUser';
import { TenantModel } from '../src/db/models/Tenant';
import { DomainModel } from '../src/db/models/Domain';
import { PlanModel } from '../src/db/models/Plan';
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
    // Stalwart domain creation and DNS provisioning happen only on explicit
    // "Activate Domain" (see domain-activation.service.ts), not at add-domain
    // time — no dnsRecords are returned here, and the domain starts unprovisioned.
    expect(res1.body.domain.stalwartDomainId).toBeNull();
    expect(res1.body.domain.dnsStatus).toBe('not_started');
    expect(res1.body.dnsRecords).toBeUndefined();

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

    // 4. Verify /api/tenants/me returns domains array
    const meRes = await request(app)
      .get('/api/tenants/me')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.tenant.domains).toHaveLength(2);
    expect(meRes.body.tenant.domain.domainName).toBe('primarybrand.com');
  });

  it('provisions mailboxes under specified domain and supports domain filtering', async () => {
    // Create two domains
    const d1 = await DomainModel.create({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      domainName: 'alpha.io',
      mailboxLimit: 10,
      status: 'active',
      isPrimary: true,
    });

    const d2 = await DomainModel.create({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      domainName: 'beta.io',
      mailboxLimit: 10,
      status: 'active',
      isPrimary: false,
    });

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
      isPrimary: true,
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
