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
  ActivationTokenModel,
  AuditLogModel,
} from '../src/db/models';
import { hashPassword, generateOidcToken, verifyTotpCode } from '../src/auth/service';
import { resetRegistrationRateLimitStore } from '../src/api/public.routes';
import { stalwartClient } from '../src/stalwart/client';
import { StalwartUnavailableError } from '../src/stalwart/errors';

let mongoServer: MongoMemoryServer;

describe('Phase 4: Stalwart Pre-Flight Verification & Tenant Activation Flow', () => {
  let superAdminToken: string;
  let superAdminId: string;
  let tenantId: string;
  let rawActivationToken: string;
  let generatedTotpSecret: string;

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
    await resetRegistrationRateLimitStore();
    vi.restoreAllMocks();

    // Default Stalwart client mock: WayneCorp domain is present
    vi.spyOn(stalwartClient, 'listDomains').mockImplementation(async () => [
      {
        id: 'dom_wayne',
        name: 'waynecorp.com',
        isEnabled: true,
      } as any,
    ]);

    // Clean DB collections
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

    // 2. Create Tenant & Domain in approved_pending_setup state
    const tenant = await TenantModel.create({
      name: 'Wayne Enterprises',
      status: 'approved_pending_setup',
      mailboxLimit: 50,
      mailboxCount: 0,
      contactEmail: 'bruce@wayne-foundation.org',
    });
    tenantId = tenant._id.toString();

    await DomainModel.create({
      tenantId: tenant._id,
      domainName: 'waynecorp.com',
      stalwartDomainId: 'dom_wayne',
      status: 'suspended',
    });
  });

  describe('Super Admin Tenant Activation (no pre-flight check)', () => {
    it('should activate tenant directly without checking Stalwart (domain provisioned at approval)', async () => {
      const res = await request(app)
        .post(`/api/platform/tenants/${tenantId}/activate`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tenant.status).toBe('active');

      // Verify tenant is now active
      const tenant = await TenantModel.findById(tenantId);
      expect(tenant?.status).toBe('active');
    });

    it('should not contact Stalwart during activation', async () => {
      // Reset tenant status for this test
      await TenantModel.findByIdAndUpdate(tenantId, { status: 'approved_pending_setup' });
      await DomainModel.updateOne({ tenantId }, { status: 'pending' });

      const listDomainsSpy = vi.spyOn(stalwartClient, 'listDomains');

      const res = await request(app)
        .post(`/api/platform/tenants/${tenantId}/activate`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(listDomainsSpy).not.toHaveBeenCalled();
    });

    it('should activate tenant and generate 48h activation token with email', async () => {
      const res = await request(app)
        .post(`/api/platform/tenants/${tenantId}/activate`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.activationLink).toContain('http://localhost:5174/activate?token=');
      expect(res.body.tenant.status).toBe('active');

      // Verify DB state
      const tenant = await TenantModel.findById(tenantId);
      expect(tenant?.status).toBe('active');

      const domain = await DomainModel.findOne({ tenantId });
      expect(domain?.status).toBe('active');

      // Verify ActivationToken created in MongoDB
      const tokenDoc = await ActivationTokenModel.findOne({ tenantId });
      expect(tokenDoc).not.toBeNull();
      expect(tokenDoc?.contactEmail).toBe('bruce@wayne-foundation.org');
      expect(tokenDoc?.usedAt).toBeFalsy();

      // Verify audit log
      const audit = await AuditLogModel.findOne({ action: 'TENANT_ACTIVATED' });
      expect(audit).not.toBeNull();
      expect(audit?.actorId?.toString()).toBe(superAdminId);
      expect(audit?.metadata?.domainName).toBe('waynecorp.com');

      // Extract raw token for subsequent test steps
      const url = new URL(res.body.activationLink);
      rawActivationToken = url.searchParams.get('token')!;
      expect(rawActivationToken).toBeDefined();
    });
  });

  describe('Public Token Validation & 2FA Secret Generation', () => {
    beforeEach(async () => {
      // Activate tenant to generate a fresh token
      const res = await request(app)
        .post(`/api/platform/tenants/${tenantId}/activate`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      const url = new URL(res.body.activationLink);
      rawActivationToken = url.searchParams.get('token')!;
    });

    it('should reject malformed or short tokens with 400', async () => {
      const res = await request(app).get('/api/public/activate-token/short-token');
      expect(res.status).toBe(400);
      expect(res.body.valid).toBe(false);
      expect(res.body.error).toBe('INVALID_TOKEN');
    });

    it('should reject non-existent token with 404', async () => {
      const fakeToken = 'a'.repeat(64);
      const res = await request(app).get(`/api/public/activate-token/${fakeToken}`);
      expect(res.status).toBe(404);
      expect(res.body.valid).toBe(false);
      expect(res.body.error).toBe('TOKEN_NOT_FOUND');
    });

    it('should validate a good token and return tenant info with TOTP QR code', async () => {
      const res = await request(app).get(`/api/public/activate-token/${rawActivationToken}`);
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.tenant.name).toBe('Wayne Enterprises');
      expect(res.body.domain).toBe('waynecorp.com');
      expect(res.body.contactEmail).toBe('bruce@wayne-foundation.org');
      expect(res.body.totpSecret).toBeDefined();
      expect(res.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

      generatedTotpSecret = res.body.totpSecret;
    });

    it('should reject expired tokens with 410', async () => {
      // Artificially expire the token
      await ActivationTokenModel.updateOne({}, { expiresAt: new Date(Date.now() - 1000) });

      const res = await request(app).get(`/api/public/activate-token/${rawActivationToken}`);
      expect(res.status).toBe(410);
      expect(res.body.error).toBe('TOKEN_EXPIRED');
    });
  });

  describe('Tenant Admin Activation & Mandatory 2FA Completion', () => {
    beforeEach(async () => {
      // Activate tenant and fetch valid token + totpSecret
      const actRes = await request(app)
        .post(`/api/platform/tenants/${tenantId}/activate`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      const url = new URL(actRes.body.activationLink);
      rawActivationToken = url.searchParams.get('token')!;

      const valRes = await request(app).get(`/api/public/activate-token/${rawActivationToken}`);
      generatedTotpSecret = valRes.body.totpSecret;
    });

    it('should reject activation if password is too short (< 8 chars)', async () => {
      const validCode = generateSync({ secret: generatedTotpSecret });
      const res = await request(app)
        .post('/api/public/activate')
        .send({
          token: rawActivationToken,
          email: 'bruce@waynecorp.com',
          password: 'short',
          totpSecret: generatedTotpSecret,
          totpCode: validCode,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('should reject activation if 6-digit TOTP code is incorrect', async () => {
      const res = await request(app)
        .post('/api/public/activate')
        .send({
          token: rawActivationToken,
          email: 'bruce@waynecorp.com',
          password: 'BatPassword2026!Secure',
          totpSecret: generatedTotpSecret,
          totpCode: '000000', // Invalid code
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_2FA_CODE');
    });

    it('should successfully complete activation with valid password and TOTP code', async () => {
      const validCode = generateSync({ secret: generatedTotpSecret });

      const res = await request(app)
        .post('/api/public/activate')
        .send({
          token: rawActivationToken,
          email: 'bruce@waynecorp.com',
          password: 'BatPassword2026!Secure',
          totpSecret: generatedTotpSecret,
          totpCode: validCode,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.role).toBe('TENANT_ADMIN');
      expect(res.body.user.twoFactorEnabled).toBe(true);

      // Verify AdminUser created in MongoDB with 2FA enabled
      const admin = await AdminUserModel.findOne({ email: 'bruce@waynecorp.com' });
      expect(admin).not.toBeNull();
      expect(admin?.role).toBe('TENANT_ADMIN');
      expect(admin?.tenantId?.toString()).toBe(tenantId);
      expect(admin?.twoFactorEnabled).toBe(true);
      expect(admin?.twoFactorSecret).toBe(generatedTotpSecret);

      // Verify token marked used
      const tokenDoc = await ActivationTokenModel.findOne({ tenantId });
      expect(tokenDoc?.usedAt).toBeDefined();

      // Verify audit log
      const audit = await AuditLogModel.findOne({ action: 'TENANT_ADMIN_ACTIVATED' });
      expect(audit).not.toBeNull();
      expect(audit?.actorRole).toBe('TENANT_ADMIN');
      expect(audit?.actorEmail).toBe('bruce@waynecorp.com');
    });

    it('should prevent token reuse after activation (single-use constraint)', async () => {
      const validCode = generateSync({ secret: generatedTotpSecret });

      // 1. First activation
      await request(app)
        .post('/api/public/activate')
        .send({
          token: rawActivationToken,
          email: 'bruce@waynecorp.com',
          password: 'BatPassword2026!Secure',
          totpSecret: generatedTotpSecret,
          totpCode: validCode,
        });

      // 2. Second activation attempt with the same token
      const res = await request(app)
        .post('/api/public/activate')
        .send({
          token: rawActivationToken,
          email: 'bruce2@waynecorp.com',
          password: 'BatPassword2026!Secure',
          totpSecret: generatedTotpSecret,
          totpCode: validCode,
        });

      expect(res.status).toBe(410);
      expect(res.body.error).toBe('TOKEN_ALREADY_USED');
    });

    it('should allow the activated Tenant Admin to authenticate via /api/auth/tenant-admin/login', async () => {
      const validCode = generateSync({ secret: generatedTotpSecret });

      // Complete activation
      await request(app)
        .post('/api/public/activate')
        .send({
          token: rawActivationToken,
          email: 'bruce@waynecorp.com',
          password: 'BatPassword2026!Secure',
          totpSecret: generatedTotpSecret,
          totpCode: validCode,
        });

      // Step 1 of login: Submit password -> returns requires2FA: true
      const loginRes = await request(app)
        .post('/api/auth/tenant-admin/login')
        .send({
          email: 'bruce@waynecorp.com',
          password: 'BatPassword2026!Secure',
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.requires2FA).toBe(true);
      expect(loginRes.body.tempToken).toBeDefined();

      // Step 2 of login: Submit 2FA code -> returns full access token
      const currentCode = generateSync({ secret: generatedTotpSecret });
      const verifyRes = await request(app)
        .post('/api/auth/2fa/verify')
        .send({
          tempToken: loginRes.body.tempToken,
          code: currentCode,
        });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.token).toBeDefined();
      expect(verifyRes.body.user.email).toBe('bruce@waynecorp.com');
      expect(verifyRes.body.user.role).toBe('TENANT_ADMIN');
    });

    it('should verify registration password via /api/public/verify-activation-password', async () => {
      // Check password too short -> 400
      const shortRes = await request(app)
        .post('/api/public/verify-activation-password')
        .send({
          token: rawActivationToken,
          password: 'short',
        });

      expect(shortRes.status).toBe(400);
      expect(shortRes.body.valid).toBe(false);
      expect(shortRes.body.error).toBe('INVALID_PASSWORD');

      // Check valid password -> 200
      const correctRes = await request(app)
        .post('/api/public/verify-activation-password')
        .send({
          token: rawActivationToken,
          password: 'RegisteredPass123!',
        });

      expect(correctRes.status).toBe(200);
      expect(correctRes.body.valid).toBe(true);
    });

    it('should complete final activation with valid password and TOTP', async () => {
      const validCode = generateSync({ secret: generatedTotpSecret });

      // Attempt activate with valid password and TOTP -> succeeds
      const successRes = await request(app)
        .post('/api/public/activate')
        .send({
          token: rawActivationToken,
          email: 'bruce@waynecorp.com',
          password: 'RegisteredPass123!',
          totpSecret: generatedTotpSecret,
          totpCode: validCode,
        });

      expect(successRes.status).toBe(200);
      expect(successRes.body.success).toBe(true);
    });
  });
});
