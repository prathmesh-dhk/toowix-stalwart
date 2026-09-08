import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { generateSync } from 'otplib';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import {
  AdminUserModel,
  TenantModel,
  DomainModel,
  RegistrationApplicationModel,
  ActivationTokenModel,
  AuditLogModel,
} from '../src/db/models';
import { hashPassword, generateOidcToken } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';
import { emailService } from '../src/services/email.service';

let mongoServer: MongoMemoryServer;

describe('Tenant Activation Email Dispatch & Onboarding Lifecycle', () => {
  let superAdminToken: string;
  let superAdminId: string;
  let pendingAppId: string;

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

    // Default Stalwart mock
    vi.spyOn(stalwartClient, 'createDomain').mockImplementation(async (name) => ({
      id: `dom_${name.replace(/\./g, '_')}`,
      name,
    }));
    vi.spyOn(stalwartClient, 'listDomains').mockImplementation(async () => []);

    // Clean DB
    await RegistrationApplicationModel.deleteMany({});
    await DomainModel.deleteMany({});
    await TenantModel.deleteMany({});
    await AdminUserModel.deleteMany({});
    await ActivationTokenModel.deleteMany({});
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

    // 2. Create pending application
    const appDoc = await RegistrationApplicationModel.create({
      companyName: 'Acme Corp',
      requestedDomain: 'acme-corp.com',
      applicantName: 'Alice Smith',
      contactEmail: 'alice@external-domain.org',
      status: 'PENDING_REVIEW',
    });
    pendingAppId = appDoc._id.toString();
  });

  it('should generate a 48h activation token and send an activation email when application is approved', async () => {
    const emailSpy = vi.spyOn(emailService, 'sendTenantActivationEmail').mockResolvedValueOnce({
      success: true,
      activationLink: 'http://localhost:5174/activate?token=testtoken',
      messageId: '<msg-123@toowix.com>',
    });

    const res = await request(app)
      .post(`/api/super-admin/applications/${pendingAppId}/approve`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.emailSent).toBe(true);
    expect(res.body.activationLink).toContain('/activate?token=');
    expect(res.body.tenant.name).toBe('Acme Corp');
    expect(res.body.tenant.contactEmail).toBe('alice@external-domain.org');

    // Verify emailService was called with correct parameters
    expect(emailSpy).toHaveBeenCalledTimes(1);
    const callArgs = emailSpy.mock.calls[0][0];
    expect(callArgs.to).toBe('alice@external-domain.org');
    expect(callArgs.companyName).toBe('Acme Corp');
    expect(callArgs.applicantName).toBe('Alice Smith');
    expect(callArgs.domainName).toBe('acme-corp.com');
    expect(callArgs.activationLink).toContain('/activate?token=');
    expect(callArgs.expiresHours).toBe(48);

    // Verify token stored in DB
    const tokenDoc = await ActivationTokenModel.findOne({ contactEmail: 'alice@external-domain.org' });
    expect(tokenDoc).not.toBeNull();
    expect(tokenDoc?.tenantId.toString()).toBe(res.body.tenant.id);
    expect(tokenDoc?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 47 * 3600 * 1000);

    // Verify audit log
    const audit = await AuditLogModel.findOne({ action: 'TENANT_APPLICATION_APPROVED' });
    expect(audit).not.toBeNull();
    expect(audit?.metadata?.emailSent).toBe(true);
    expect(audit?.metadata?.activationLink).toBeDefined();
  });

  it('should not fail approval if SMTP dispatch errors (graceful fallback)', async () => {
    vi.spyOn(emailService, 'sendTenantActivationEmail').mockResolvedValueOnce({
      success: false,
      activationLink: 'http://localhost:5174/activate?token=testtoken',
      error: 'ECONNREFUSED 127.0.0.1:2525',
    });

    const res = await request(app)
      .post(`/api/super-admin/applications/${pendingAppId}/approve`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.emailSent).toBe(false);
    expect(res.body.emailError).toBe('ECONNREFUSED 127.0.0.1:2525');
    expect(res.body.activationLink).toBeDefined();
  });

  it('should complete tenant activation and transition tenant status to active', async () => {
    // 1. Approve application
    const approveRes = await request(app)
      .post(`/api/super-admin/applications/${pendingAppId}/approve`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    const activationUrl = new URL(approveRes.body.activationLink);
    const token = activationUrl.searchParams.get('token')!;

    // 2. Validate token
    const tokenRes = await request(app).get(`/api/public/activate-token/${token}`);
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.valid).toBe(true);
    const totpSecret = tokenRes.body.totpSecret;

    // 3. Complete activation
    const totpCode = generateSync({ secret: totpSecret });
    const activateRes = await request(app)
      .post('/api/public/activate')
      .send({
        token,
        email: 'alice@acme-corp.com',
        password: 'SecurePassword2026!Batch',
        totpSecret,
        totpCode,
      });

    expect(activateRes.status).toBe(200);
    expect(activateRes.body.success).toBe(true);
    expect(activateRes.body.user.email).toBe('alice@acme-corp.com');

    // Verify tenant transitioned to active
    const tenant = await TenantModel.findById(approveRes.body.tenant.id);
    expect(tenant?.status).toBe('active');

    // Verify token marked used
    const tokenDoc = await ActivationTokenModel.findOne({ tenantId: tenant?._id });
    expect(tokenDoc?.usedAt).toBeDefined();
  });

  it('should resend activation email via /api/platform/tenants/:id/resend-activation', async () => {
    // 1. Approve application
    const approveRes = await request(app)
      .post(`/api/super-admin/applications/${pendingAppId}/approve`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    const tenantId = approveRes.body.tenant.id;

    const emailSpy = vi.spyOn(emailService, 'sendTenantActivationEmail').mockResolvedValueOnce({
      success: true,
      activationLink: 'http://localhost:5174/activate?token=fresh_token',
      messageId: '<resend-msg@toowix.com>',
    });

    // 2. Resend activation
    const resendRes = await request(app)
      .post(`/api/platform/tenants/${tenantId}/resend-activation`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(resendRes.status).toBe(200);
    expect(resendRes.body.success).toBe(true);
    expect(resendRes.body.emailSent).toBe(true);
    expect(resendRes.body.contactEmail).toBe('alice@external-domain.org');
    expect(resendRes.body.activationLink).toContain('/activate?token=');
    expect(emailSpy).toHaveBeenCalledTimes(1);

    // Verify audit log
    const audit = await AuditLogModel.findOne({ action: 'TENANT_ACTIVATION_EMAIL_RESENT' });
    expect(audit).not.toBeNull();
    expect(audit?.tenantId.toString()).toBe(tenantId);
  });
});
