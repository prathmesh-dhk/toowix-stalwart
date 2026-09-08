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
  RegistrationApplicationModel,
  AuditLogModel,
} from '../src/db/models';
import { hashPassword, generateOidcToken } from '../src/auth/service';
import { resetRegistrationRateLimitStore } from '../src/api/public.routes';
import { stalwartClient } from '../src/stalwart/client';
import { StalwartDomainExistsError, StalwartUnavailableError } from '../src/stalwart/errors';

let mongoServer: MongoMemoryServer;

describe('Phase 3: Public Registration & Super Admin Application Queue', () => {
  let superAdminToken: string;
  let superAdminId: string;
  let tenantAdminToken: string;

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
    resetRegistrationRateLimitStore();
    vi.restoreAllMocks();

    vi.spyOn(stalwartClient, 'createDomain').mockImplementation(async (domainName: string) => ({
      id: `dom_${domainName.replace(/[^a-zA-Z0-9]/g, '_')}`,
      name: domainName,
    }));
    vi.spyOn(stalwartClient, 'listDomains').mockImplementation(async () => [
      {
        id: 'dom_existing',
        name: 'starkindustries.tech',
        isEnabled: true,
      } as any,
    ]);

    // Clean all collections
    await RegistrationApplicationModel.deleteMany({});
    await DomainModel.deleteMany({});
    await TenantModel.deleteMany({});
    await AdminUserModel.deleteMany({});
    await AuditLogModel.deleteMany({});

    // 1. Create Super Admin
    const superAdmin = await AdminUserModel.create({
      email: 'super@toowix.com',
      passwordHash: await hashPassword('SuperSecret2026!'),
      role: 'SUPER_ADMIN',
      tenantId: null,
      status: 'active',
      twoFactorEnabled: false,
    });
    superAdminId = superAdmin._id.toString();
    superAdminToken = generateOidcToken({
      id: superAdmin._id.toString(),
      email: superAdmin.email,
      role: 'SUPER_ADMIN',
      tenantId: null,
      twoFactorEnabled: false,
    });

    // 2. Create a Tenant and Tenant Admin
    const tenant = await TenantModel.create({
      name: 'Existing Tenant Corp',
      status: 'active',
      mailboxLimit: 25,
      mailboxCount: 0,
    });
    const tenantAdmin = await AdminUserModel.create({
      email: 'tenantadmin@existing.com',
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

    // 3. Register existing domain for that tenant
    await DomainModel.create({
      tenantId: tenant._id,
      domainName: 'existingcorp.com',
      status: 'active',
    });
  });

  describe('POST /api/public/register-tenant (Public Self-Service Registration)', () => {
    it('should successfully submit a valid application and audit the event', async () => {
      const payload = {
        companyName: 'Apex Cloud Solutions',
        requestedDomain: 'apexcloud.io',
        applicantName: 'Sarah Connor',
        contactEmail: 's.connor@gmail.com',
        phone: '+1 555-0199',
        notes: 'Migrating 30 mailboxes from Google Workspace',
      };

      const res = await request(app)
        .post('/api/public/register-tenant')
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.application.companyName).toBe('Apex Cloud Solutions');
      expect(res.body.application.requestedDomain).toBe('apexcloud.io');
      expect(res.body.application.status).toBe('PENDING_REVIEW');

      // Verify in MongoDB
      const saved = await RegistrationApplicationModel.findOne({ requestedDomain: 'apexcloud.io' });
      expect(saved).not.toBeNull();
      expect(saved?.contactEmail).toBe('s.connor@gmail.com');
      expect(saved?.notes).toBe(payload.notes);

      // Verify audit log
      const audit = await AuditLogModel.findOne({ action: 'TENANT_APPLICATION_SUBMITTED' });
      expect(audit).not.toBeNull();
      expect(audit?.actorRole).toBe('ANONYMOUS');
      expect(audit?.actorEmail).toBe('s.connor@gmail.com');
    });

    it('should reject invalid domain formats', async () => {
      const invalidDomains = ['invalid', 'http://domain.com', 'has space.com', 'domain..com'];

      for (const domain of invalidDomains) {
        const res = await request(app)
          .post('/api/public/register-tenant')
          .send({
            companyName: 'Test Corp',
            requestedDomain: domain,
            applicantName: 'John Doe',
            contactEmail: 'john@gmail.com',
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject reserved domains (e.g. toowix.com, localhost)', async () => {
      const res = await request(app)
        .post('/api/public/register-tenant')
        .send({
          companyName: 'Imposter Corp',
          requestedDomain: 'toowix.com',
          applicantName: 'Mallory',
          contactEmail: 'mallory@external.net',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body.details)).toMatch(/reserved/i);
    });

    it('should reject registration if domain already exists on active platform', async () => {
      const res = await request(app)
        .post('/api/public/register-tenant')
        .send({
          companyName: 'Copycat Inc',
          requestedDomain: 'existingcorp.com',
          applicantName: 'Bob Builder',
          contactEmail: 'bob@builders.org',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('DOMAIN_ALREADY_EXISTS');
    });

    it('should reject duplicate application if one is already PENDING_REVIEW', async () => {
      // First submission
      await request(app)
        .post('/api/public/register-tenant')
        .send({
          companyName: 'First Try',
          requestedDomain: 'pendingtest.org',
          applicantName: 'Alice',
          contactEmail: 'alice@gmail.com',
        });

      // Second submission for same domain
      const res = await request(app)
        .post('/api/public/register-tenant')
        .send({
          companyName: 'Second Try',
          requestedDomain: 'pendingtest.org',
          applicantName: 'Bob',
          contactEmail: 'bob@gmail.com',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('APPLICATION_ALREADY_PENDING');
    });
  });

  describe('Super Admin Application Queue', () => {
    let pendingAppId: string;

    beforeEach(async () => {
      const appDoc = await RegistrationApplicationModel.create({
        companyName: 'Stark Industries',
        requestedDomain: 'starkindustries.tech',
        applicantName: 'Tony Stark',
        contactEmail: 'tony@external-avengers.org',
        status: 'PENDING_REVIEW',
      });
      pendingAppId = appDoc._id.toString();
    });

    it('should deny unauthenticated access', async () => {
      const res = await request(app).get('/api/super-admin/applications');
      expect(res.status).toBe(401);
    });

    it('should deny Tenant Admin access (only Super Admin allowed)', async () => {
      const res = await request(app)
        .get('/api/super-admin/applications')
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(res.status).toBe(403);
    });

    it('should list applications for Super Admin with status filtering', async () => {
      const res = await request(app)
        .get('/api/super-admin/applications?status=PENDING_REVIEW')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.applications).toHaveLength(1);
      expect(res.body.applications[0].requestedDomain).toBe('starkindustries.tech');
      expect(res.body.pagination.total).toBe(1);
    });

    it('should get application details by ID', async () => {
      const res = await request(app)
        .get(`/api/super-admin/applications/${pendingAppId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.application._id).toBe(pendingAppId);
      expect(res.body.application.companyName).toBe('Stark Industries');
    });

    it('should return 400 for malformed application ID', async () => {
      const res = await request(app)
        .get('/api/super-admin/applications/not-a-valid-id')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_ID');
    });

    it('should return 404 for non-existent application ID', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .get(`/api/super-admin/applications/${nonExistentId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(404);
    });

    it('should approve application: creates Tenant and provisions Domain on Stalwart', async () => {
      const res = await request(app)
        .post(`/api/super-admin/applications/${pendingAppId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tenant.status).toBe('approved_pending_setup');
      expect(res.body.tenant.domain).toBe('starkindustries.tech');
      expect(res.body.tenant.stalwartDomainId).toBe('dom_starkindustries_tech');

      // Verify application record updated
      const updatedApp = await RegistrationApplicationModel.findById(pendingAppId);
      expect(updatedApp?.status).toBe('APPROVED');
      expect(updatedApp?.reviewedBy?.toString()).toBe(superAdminId);
      expect(updatedApp?.reviewedAt).toBeDefined();

      // Verify Tenant created in DB
      const tenant = await TenantModel.findById(res.body.tenant.id);
      expect(tenant).not.toBeNull();
      expect(tenant?.status).toBe('approved_pending_setup');
      expect(tenant?.mailboxLimit).toBe(50);

      // Verify Domain created in DB in active state with stalwartDomainId
      const domain = await DomainModel.findOne({ domainName: 'starkindustries.tech' });
      expect(domain).not.toBeNull();
      expect(domain?.status).toBe('active');
      expect(domain?.stalwartDomainId).toBe('dom_starkindustries_tech');
      expect(domain?.tenantId.toString()).toBe(tenant?._id.toString());

      // Verify audit log
      const audit = await AuditLogModel.findOne({ action: 'TENANT_APPLICATION_APPROVED' });
      expect(audit).not.toBeNull();
      expect(audit?.actorId?.toString()).toBe(superAdminId);
      expect(audit?.tenantId?.toString()).toBe(tenant?._id.toString());
      expect(audit?.metadata?.stalwartDomainId).toBe('dom_starkindustries_tech');
    });

    it('should handle existing domain on Stalwart gracefully by reusing domain ID', async () => {
      vi.spyOn(stalwartClient, 'createDomain').mockRejectedValueOnce(
        new StalwartDomainExistsError('starkindustries.tech')
      );

      const res = await request(app)
        .post(`/api/super-admin/applications/${pendingAppId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tenant.stalwartDomainId).toBe('dom_existing');

      const domain = await DomainModel.findOne({ domainName: 'starkindustries.tech' });
      expect(domain?.stalwartDomainId).toBe('dom_existing');
    });

    it('should return 502 if Stalwart is unreachable during approval', async () => {
      vi.spyOn(stalwartClient, 'createDomain').mockRejectedValueOnce(
        new StalwartUnavailableError('Stalwart server connection timeout')
      );

      const res = await request(app)
        .post(`/api/super-admin/applications/${pendingAppId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(502);
      expect(res.body.error).toBe('STALWART_DOMAIN_PROVISION_FAILED');

      // Application should still be PENDING_REVIEW
      const appDoc = await RegistrationApplicationModel.findById(pendingAppId);
      expect(appDoc?.status).toBe('PENDING_REVIEW');

      // No tenant or domain should be created
      const domain = await DomainModel.findOne({ domainName: 'starkindustries.tech' });
      expect(domain).toBeNull();
    });

    it('should reject approving an application that is not PENDING_REVIEW', async () => {
      // First approve
      await request(app)
        .post(`/api/super-admin/applications/${pendingAppId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      // Try approving again
      const res = await request(app)
        .post(`/api/super-admin/applications/${pendingAppId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_STATUS');
    });

    it('should reject application with reason and audit the event', async () => {
      const res = await request(app)
        .post(`/api/super-admin/applications/${pendingAppId}/reject`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Incomplete applicant details and unverifiable business registration.' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.application.status).toBe('REJECTED');
      expect(res.body.application.rejectionReason).toContain('Incomplete applicant details');

      // Verify DB record
      const updatedApp = await RegistrationApplicationModel.findById(pendingAppId);
      expect(updatedApp?.status).toBe('REJECTED');
      expect(updatedApp?.rejectionReason).toBe('Incomplete applicant details and unverifiable business registration.');

      // Verify no Tenant was created
      const tenant = await TenantModel.findOne({ name: 'Stark Industries' });
      expect(tenant).toBeNull();

      // Verify audit log
      const audit = await AuditLogModel.findOne({ action: 'TENANT_APPLICATION_REJECTED' });
      expect(audit).not.toBeNull();
      expect(audit?.metadata?.rejectionReason).toBe(updatedApp?.rejectionReason);
    });

    it('should fail rejecting application without a valid reason', async () => {
      const res = await request(app)
        .post(`/api/super-admin/applications/${pendingAppId}/reject`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'no' }); // less than 3 chars

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });
});
