import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { AdminUserModel, TenantModel, DomainModel } from '../src/db/models';
import { PlanModel } from '../src/db/models/Plan';
import { generateOidcToken } from '../src/auth/service';

let mongoServer: MongoMemoryServer;

describe('Plans API (seat tiers)', () => {
  let superAdminToken: string;
  let tenantAdminToken: string;
  let tenantId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri() });
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await AdminUserModel.deleteMany({});
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await PlanModel.deleteMany({});

    const superAdmin = await AdminUserModel.create({
      email: 'super@toowix.test',
      passwordHash: 'dummyhash',
      role: 'SUPER_ADMIN',
      status: 'active',
      twoFactorEnabled: false,
    });
    superAdminToken = generateOidcToken({
      id: superAdmin._id.toString(),
      email: superAdmin.email,
      role: 'SUPER_ADMIN',
      tenantId: null,
      twoFactorEnabled: false,
    });

    const tenant = await TenantModel.create({
      name: 'Acme Co',
      status: 'active',
      mailboxLimit: 10,
      mailboxCount: 0,
    });
    tenantId = tenant._id.toString();

    const tenantAdmin = await AdminUserModel.create({
      email: 'admin@acme.test',
      passwordHash: 'dummyhash',
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
      status: 'active',
      twoFactorEnabled: false,
    });
    tenantAdminToken = generateOidcToken({
      id: tenantAdmin._id.toString(),
      email: tenantAdmin.email,
      role: 'TENANT_ADMIN',
      tenantId,
      twoFactorEnabled: false,
    });
  });

  it('blocks Tenant Admin from CRUD but allows listing active plans', async () => {
    await PlanModel.create({ name: 'Team', seatCount: 10, displayOrder: 1, isActive: true });
    await PlanModel.create({ name: 'Archived', seatCount: 5, displayOrder: 2, isActive: false });

    const listRes = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.plans).toHaveLength(1);
    expect(listRes.body.plans[0].name).toBe('Team');

    const createRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ name: 'Hacker Plan', seatCount: 999999 });
    expect(createRes.status).toBe(403);
  });

  it('lets Super Admin create, update, and enforce a single default plan', async () => {
    const createRes = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Team', badge: 'Standard', seatCount: 10, displayOrder: 1, isDefault: true });
    expect(createRes.status).toBe(201);
    const plan1Id = createRes.body.plan.id;
    expect(createRes.body.plan.isDefault).toBe(true);

    const createRes2 = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Business', seatCount: 50, displayOrder: 2, isDefault: true });
    expect(createRes2.status).toBe(201);
    const plan2Id = createRes2.body.plan.id;

    // Only the most recently flagged plan should remain default
    const allRes = await request(app)
      .get('/api/plans/all')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(allRes.status).toBe(200);
    const plan1 = allRes.body.plans.find((p: any) => p.id === plan1Id);
    const plan2 = allRes.body.plans.find((p: any) => p.id === plan2Id);
    expect(plan1.isDefault).toBe(false);
    expect(plan2.isDefault).toBe(true);

    const updateRes = await request(app)
      .patch(`/api/plans/${plan1Id}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ seatCount: 15 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.plan.seatCount).toBe(15);
  });

  it('blocks deleting a plan still assigned to a domain, allows it once unassigned', async () => {
    const plan = await PlanModel.create({ name: 'Team', seatCount: 10, displayOrder: 1, isActive: true });
    const domain = await DomainModel.create({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      domainName: 'inuse.com',
      mailboxLimit: 10,
      employeeCount: 10,
      planId: plan._id,
      planName: plan.name,
      status: 'active',
      isPrimary: true,
    });

    const blockedRes = await request(app)
      .delete(`/api/plans/${plan._id.toString()}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(blockedRes.status).toBe(409);
    expect(blockedRes.body.error).toBe('PLAN_IN_USE');

    await DomainModel.deleteOne({ _id: domain._id });

    const okRes = await request(app)
      .delete(`/api/plans/${plan._id.toString()}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(okRes.status).toBe(200);
    expect(okRes.body.success).toBe(true);
  });

  it('lets a tenant admin create a domain by planId, resolving seat count server-side', async () => {
    const plan = await PlanModel.create({ name: 'Growth', seatCount: 25, displayOrder: 1, isActive: true });

    const res = await request(app)
      .post('/api/tenants/me/domains')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ domainName: 'plandomain.com', planId: plan._id.toString() });

    expect(res.status).toBe(201);
    expect(res.body.domain.mailboxLimit).toBe(25);
    expect(res.body.domain.employeeCount).toBe(25);
    expect(res.body.domain.planId).toBe(plan._id.toString());
    expect(res.body.domain.planName).toBe('Growth');
  });

  it('rejects domain creation against an inactive or missing plan', async () => {
    const inactivePlan = await PlanModel.create({ name: 'Retired', seatCount: 10, displayOrder: 1, isActive: false });

    const res = await request(app)
      .post('/api/tenants/me/domains')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ domainName: 'blocked.com', planId: inactivePlan._id.toString() });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('PLAN_NOT_FOUND');
  });
});
