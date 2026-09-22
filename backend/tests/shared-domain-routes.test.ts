import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import {
  AdminUserModel,
  TenantModel,
  DomainModel,
  MailboxModel,
  PlanModel,
  DomainSubscriptionModel,
} from '../src/db/models';
import { generateOidcToken } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';
import { seedPlatformIdentityDomain } from '../src/db/seed';
import { config } from '../src/config';

let mongoServer: MongoMemoryServer;

describe('Shared platform domain (dhkmail.com) through the tenant-facing routes', () => {
  let tenantId: string;
  let tenantAdminToken: string;
  let planId: string;
  let sharedDomainId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri() });

    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([{ id: 'stalwart-dhkmail', name: config.platformMailDomain }]);
    vi.spyOn(stalwartClient, 'createDomain').mockResolvedValue({ id: 'stalwart-dhkmail', name: config.platformMailDomain });
    vi.spyOn(stalwartClient, 'createAccount').mockResolvedValue({ id: 'stalwart-acc-x', name: 'x' } as any);
    vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await disconnectDatabase();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await Promise.all(
      [TenantModel, DomainModel, AdminUserModel, MailboxModel, PlanModel, DomainSubscriptionModel].map((m) =>
        m.deleteMany({})
      )
    );

    await seedPlatformIdentityDomain();
    const sharedDomain = await DomainModel.findOne({ domainName: config.platformMailDomain });
    sharedDomainId = sharedDomain!._id.toString();

    const plan = await PlanModel.create({ name: 'Team', seatCount: 5, displayOrder: 1, isActive: true });
    planId = plan._id.toString();

    const tenant = await TenantModel.create({ name: 'Acme Corp', status: 'active', mailboxLimit: 50, mailboxCount: 0 });
    tenantId = tenant._id.toString();

    const admin = await AdminUserModel.create({
      email: 'admin@acme.test',
      passwordHash: 'argon2id$mocked',
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
      status: 'active',
      twoFactorEnabled: true,
    });
    tenantAdminToken = generateOidcToken({
      id: admin._id.toString(),
      email: admin.email,
      role: 'TENANT_ADMIN',
      tenantId,
      twoFactorEnabled: true,
    });
  });

  it('GET /me/domains omits dhkmail when the tenant has never subscribed', async () => {
    const res = await request(app).get('/api/tenants/me/domains').set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.domains.find((d: any) => d.domainName === config.platformMailDomain)).toBeUndefined();
  });

  it('GET /me and /me/domains include dhkmail, scoped to this tenant, once subscribed', async () => {
    await DomainSubscriptionModel.create({
      domainId: sharedDomainId,
      tenantId,
      planId,
      stripeSubscriptionId: 'sub_x',
      stripeSubscriptionItemId: 'si_x',
      status: 'active',
      mailboxLimit: 5,
      mailboxCount: 0,
    });

    const listRes = await request(app).get('/api/tenants/me/domains').set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(listRes.status).toBe(200);
    const entry = listRes.body.domains.find((d: any) => d.domainName === config.platformMailDomain);
    expect(entry).toMatchObject({ isSharedDomain: true, mailboxLimit: 5, mailboxCount: 0 });

    const meRes = await request(app).get('/api/tenants/me').set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.tenant.domains.find((d: any) => d.domainName === config.platformMailDomain)).toMatchObject({
      isSharedDomain: true,
    });
  });

  it('POST /me/mailboxes with the dhkmail domainId creates a shared-domain mailbox, not an ordinary one', async () => {
    await DomainSubscriptionModel.create({
      domainId: sharedDomainId,
      tenantId,
      planId,
      stripeSubscriptionId: 'sub_x',
      stripeSubscriptionItemId: 'si_x',
      status: 'active',
      mailboxLimit: 5,
      mailboxCount: 0,
    });

    const res = await request(app)
      .post('/api/tenants/me/mailboxes')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ localPart: 'sales', password: 'Password123!', domainId: sharedDomainId });

    expect(res.status).toBe(201);
    expect(res.body.address).toBe(`sales@${config.platformMailDomain}`);
    expect(res.body.tenantId).toBe(tenantId);

    // Never touched the tenant's own (unrelated) mailbox quota.
    expect((await TenantModel.findById(tenantId))!.mailboxCount).toBe(0);
    const sub = await DomainSubscriptionModel.findOne({ domainId: sharedDomainId, tenantId });
    expect(sub!.mailboxCount).toBe(1);

    const listRes = await request(app).get('/api/tenants/me/mailboxes').set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(listRes.body.mailboxes).toHaveLength(1);
    expect(listRes.body.mailboxes[0].tenantId).toBe(tenantId);
  });

  it('POST /me/mailboxes on dhkmail without a subscription is rejected with 402', async () => {
    const res = await request(app)
      .post('/api/tenants/me/mailboxes')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ localPart: 'sales', password: 'Password123!', domainId: sharedDomainId });

    expect(res.status).toBe(402);
    expect(await MailboxModel.countDocuments({})).toBe(0);
  });
});
