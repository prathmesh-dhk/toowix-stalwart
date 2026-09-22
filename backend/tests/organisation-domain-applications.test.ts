import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import {
  AdminUserModel,
  TenantModel,
  DomainModel,
  PlanModel,
  RegistrationApplicationModel,
  AuditLogModel,
} from '../src/db/models';
import { hashPassword, generateOidcToken } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';

let mongoServer: MongoMemoryServer;

describe('Organisation Domain Applications & Super Admin Queue', () => {
  let superAdminToken: string;
  let tenantAdminToken: string;
  let tenantId: string;
  let planId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await connectDatabase({ uri, autoIndex: true });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();

    vi.spyOn(stalwartClient, 'createDomain').mockImplementation(async (domainName: string) => ({
      id: `dom_${domainName.replace(/[^a-zA-Z0-9]/g, '_')}`,
      name: domainName,
    }));
    vi.spyOn(stalwartClient, 'updateDomainStatus').mockResolvedValue();
    vi.spyOn(stalwartClient, 'deleteDomain').mockResolvedValue();
    vi.spyOn(stalwartClient, 'getActiveDkimKeysWithRetry').mockResolvedValue([]);
    vi.spyOn(stalwartClient, 'getDomain').mockResolvedValue(null);

    await RegistrationApplicationModel.deleteMany({});
    await DomainModel.deleteMany({});
    await TenantModel.deleteMany({});
    await AdminUserModel.deleteMany({});
    await PlanModel.deleteMany({});
    await AuditLogModel.deleteMany({});

    // Super Admin
    const superAdmin = await AdminUserModel.create({
      email: 'superadmin@toowix.com',
      passwordHash: await hashPassword('SuperSecret2026!'),
      role: 'SUPER_ADMIN',
      tenantId: null,
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

    // Tenant & Tenant Admin
    const tenant = await TenantModel.create({
      name: 'Acme Corporation',
      status: 'active',
      mailboxLimit: 50,
      mailboxCount: 0,
      contactEmail: 'contact@acme.com',
    });
    tenantId = tenant._id.toString();

    const tenantAdmin = await AdminUserModel.create({
      name: 'Alice Admin',
      email: 'alice@acme.com',
      passwordHash: await hashPassword('TenantSecret2026!'),
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
      status: 'active',
      twoFactorEnabled: false,
    });
    tenantAdminToken = generateOidcToken({
      id: tenantAdmin._id.toString(),
      email: tenantAdmin.email,
      role: 'TENANT_ADMIN',
      tenantId: tenant._id.toString(),
      twoFactorEnabled: false,
    });

    // Plan
    const plan = await PlanModel.create({
      name: 'Business Pro',
      slug: 'business-pro',
      seatCount: 15,
      priceMonthlyCents: 5000,
      priceYearlyCents: 50000,
      features: ['All Features'],
      isActive: true,
      displayOrder: 1,
    });
    planId = plan._id.toString();
  });

  it('creates a RegistrationApplication when an existing organisation adds a domain', async () => {
    const res = await request(app)
      .post('/api/tenants/me/domains')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({
        domainName: 'newdomain.acme.com',
        planId,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.domain.domainName).toBe('newdomain.acme.com');

    // Verify application created
    const appDoc = await RegistrationApplicationModel.findOne({ requestedDomain: 'newdomain.acme.com' });
    expect(appDoc).not.toBeNull();
    expect(appDoc!.status).toBe('PENDING_REVIEW');
    expect(appDoc!.companyName).toBe('Acme Corporation');
    expect(appDoc!.applicantName).toBe('Alice Admin');
    expect(appDoc!.contactEmail).toBe('alice@acme.com');
    expect(appDoc!.tenantId?.toString()).toBe(tenantId);
  });

  it('lists existing organisation domain applications in super-admin applications queue', async () => {
    // Add domain
    await request(app)
      .post('/api/tenants/me/domains')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({
        domainName: 'shop.acme.com',
        planId,
      });

    // Query Super Admin applications
    const res = await request(app)
      .get('/api/super-admin/applications?status=PENDING_REVIEW')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.applications.length).toBe(1);
    expect(res.body.applications[0].requestedDomain).toBe('shop.acme.com');
    expect(res.body.applications[0].companyName).toBe('Acme Corporation');
    expect(res.body.applications[0].tenantId).toBe(tenantId);
  });

  it('allows Super Admin to approve existing organisation domain application without creating duplicate tenant', async () => {
    // Add domain
    await request(app)
      .post('/api/tenants/me/domains')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({
        domainName: 'corp.acme.com',
        planId,
      });

    const appDoc = await RegistrationApplicationModel.findOne({ requestedDomain: 'corp.acme.com' });
    expect(appDoc).not.toBeNull();

    // Super Admin approves
    const approveRes = await request(app)
      .post(`/api/super-admin/applications/${appDoc!._id}/approve`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.success).toBe(true);
    expect(approveRes.body.tenant.id).toBe(tenantId);
    expect(approveRes.body.tenant.domain).toBe('corp.acme.com');

    // Check application status
    const updatedApp = await RegistrationApplicationModel.findById(appDoc!._id);
    expect(updatedApp!.status).toBe('APPROVED');
    expect(updatedApp!.reviewedAt).not.toBeNull();

    // Check domain is active
    const domain = await DomainModel.findOne({ domainName: 'corp.acme.com' });
    expect(domain!.status).toBe('active');

    // Verify tenant count didn't increase (no duplicate tenant created)
    const tenantCount = await TenantModel.countDocuments({});
    expect(tenantCount).toBe(1);
  });

  it('allows Super Admin to reject existing organisation domain application and marks domain suspended', async () => {
    // Add domain
    await request(app)
      .post('/api/tenants/me/domains')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({
        domainName: 'bad.acme.com',
        planId,
      });

    const appDoc = await RegistrationApplicationModel.findOne({ requestedDomain: 'bad.acme.com' });

    // Super Admin rejects
    const rejectRes = await request(app)
      .post(`/api/super-admin/applications/${appDoc!._id}/reject`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ reason: 'Domain not authorized for this business' });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.success).toBe(true);

    const updatedApp = await RegistrationApplicationModel.findById(appDoc!._id);
    expect(updatedApp!.status).toBe('REJECTED');
    expect(updatedApp!.rejectionReason).toBe('Domain not authorized for this business');

    const domain = await DomainModel.findOne({ domainName: 'bad.acme.com' });
    expect(domain!.status).toBe('suspended');
  });

  it('cleans up pending application when tenant deletes the domain', async () => {
    // Add domain
    const createRes = await request(app)
      .post('/api/tenants/me/domains')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({
        domainName: 'temporary.acme.com',
        planId,
      });

    const domainId = createRes.body.domain.id;
    expect(await RegistrationApplicationModel.countDocuments({ requestedDomain: 'temporary.acme.com' })).toBe(1);

    // Tenant deletes domain
    const delRes = await request(app)
      .delete(`/api/tenants/domains/${domainId}`)
      .set('Authorization', `Bearer ${tenantAdminToken}`);

    expect(delRes.status).toBe(200);

    // Application record should be removed
    expect(await RegistrationApplicationModel.countDocuments({ requestedDomain: 'temporary.acme.com' })).toBe(0);
  });
});
