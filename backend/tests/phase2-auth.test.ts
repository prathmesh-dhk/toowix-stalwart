import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { generateSecret, generateSync } from 'otplib';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { AdminUserModel, TenantModel } from '../src/db/models';
import { hashPassword } from '../src/auth/service';
import { resetRateLimitStore } from '../src/auth/middleware';

let mongoServer: MongoMemoryServer;

describe('Phase 2: Authentication Engine, TOTP 2FA & Dual Portal Routing', () => {
  let superAdminId: string;
  let tenantAdminId: string;
  let tenantId: string;
  const superPassword = 'SuperSecretPassword2026!';
  const tenantPassword = 'TenantSecretPassword2026!';
  let tenant2FaSecret: string;

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
    await resetRateLimitStore();
    // Clean database collections
    await AdminUserModel.deleteMany({});
    await TenantModel.deleteMany({});

    // Create a tenant
    const tenant = await TenantModel.create({
      name: 'Acme Logistics',
      status: 'active',
      mailboxLimit: 50,
      mailboxCount: 0,
    });
    tenantId = tenant._id.toString();

    // Create a Super Admin account (without 2FA enabled initially)
    const superAdmin = await AdminUserModel.create({
      email: 'super@toowix.com',
      passwordHash: await hashPassword(superPassword),
      role: 'SUPER_ADMIN',
      tenantId: null,
      status: 'active',
      twoFactorEnabled: false,
    });
    superAdminId = superAdmin._id.toString();

    // Create a Tenant Admin account (with 2FA enabled)
    tenant2FaSecret = generateSecret();
    const tenantAdmin = await AdminUserModel.create({
      email: 'admin@acme.com',
      passwordHash: await hashPassword(tenantPassword),
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
      status: 'active',
      twoFactorEnabled: true,
      twoFactorSecret: tenant2FaSecret,
    });
    tenantAdminId = tenantAdmin._id.toString();
  });

  describe('Backend-Authoritative Portal Separation', () => {
    it('should successfully authenticate Super Admin on /api/auth/super-admin/login', async () => {
      const res = await request(app)
        .post('/api/auth/super-admin/login')
        .send({ email: 'super@toowix.com', password: superPassword });

      expect(res.status).toBe(200);
      expect(res.body.requires2FA).toBe(false);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.role).toBe('SUPER_ADMIN');
    });

    it('should REJECT Tenant Admin trying to log into Super Admin portal (/api/auth/super-admin/login)', async () => {
      const res = await request(app)
        .post('/api/auth/super-admin/login')
        .send({ email: 'admin@acme.com', password: tenantPassword });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('AUTH_FAILED');
      expect(res.body.message).toMatch(/not authorized for the Super Admin portal/i);
    });

    it('should REJECT Super Admin trying to log into Tenant Admin portal (/api/auth/tenant-admin/login)', async () => {
      const res = await request(app)
        .post('/api/auth/tenant-admin/login')
        .send({ email: 'super@toowix.com', password: superPassword });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('AUTH_FAILED');
      expect(res.body.message).toMatch(/not authorized for the Tenant Admin portal/i);
    });

    it('should reject invalid password with 401', async () => {
      const res = await request(app)
        .post('/api/auth/super-admin/login')
        .send({ email: 'super@toowix.com', password: 'WrongPassword123' });

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/invalid email or password/i);
    });
  });

  describe('TOTP 2FA Verification Flow', () => {
    it('should return requires2FA: true and tempToken for user with 2FA enabled', async () => {
      const res = await request(app)
        .post('/api/auth/tenant-admin/login')
        .send({ email: 'admin@acme.com', password: tenantPassword });

      expect(res.status).toBe(200);
      expect(res.body.requires2FA).toBe(true);
      expect(res.body.tempToken).toBeDefined();
      expect(res.body.token).toBeUndefined(); // Full access token not granted yet!
    });

    it('should complete 2FA login with valid 6-digit TOTP code', async () => {
      // 1. Initial login returns tempToken
      const loginRes = await request(app)
        .post('/api/auth/tenant-admin/login')
        .send({ email: 'admin@acme.com', password: tenantPassword });

      const tempToken = loginRes.body.tempToken;
      expect(tempToken).toBeDefined();

      // 2. Generate valid TOTP code using secret
      const validCode = generateSync({ secret: tenant2FaSecret });

      // 3. Submit code to verify endpoint
      const verifyRes = await request(app)
        .post('/api/auth/2fa/verify')
        .send({ tempToken, code: validCode });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.token).toBeDefined();
      expect(verifyRes.body.user.role).toBe('TENANT_ADMIN');
      expect(verifyRes.body.user.tenantId).toBe(tenantId);
    });

    it('should reject invalid 6-digit TOTP code', async () => {
      const loginRes = await request(app)
        .post('/api/auth/tenant-admin/login')
        .send({ email: 'admin@acme.com', password: tenantPassword });

      const tempToken = loginRes.body.tempToken;

      const verifyRes = await request(app)
        .post('/api/auth/2fa/verify')
        .send({ tempToken, code: '000000' });

      expect(verifyRes.status).toBe(401);
      expect(verifyRes.body.error).toBe('2FA_FAILED');
    });
  });

  describe('Session Inspection & Protected Endpoints', () => {
    it('should allow /api/auth/me with valid Bearer token', async () => {
      const loginRes = await request(app)
        .post('/api/auth/super-admin/login')
        .send({ email: 'super@toowix.com', password: superPassword });

      const token = loginRes.body.token;

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.user.email).toBe('super@toowix.com');
      expect(meRes.body.user.role).toBe('SUPER_ADMIN');
    });

    it('should reject /api/auth/me without token with 401', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('2FA Setup Flow', () => {
    it('should generate QR code and enable 2FA after confirmation', async () => {
      // 1. Log in as Super Admin (2FA is disabled initially)
      const loginRes = await request(app)
        .post('/api/auth/super-admin/login')
        .send({ email: 'super@toowix.com', password: superPassword });

      const token = loginRes.body.token;

      // 2. Request 2FA Setup
      const setupRes = await request(app)
        .post('/api/auth/2fa/setup')
        .set('Authorization', `Bearer ${token}`);

      expect(setupRes.status).toBe(200);
      expect(setupRes.body.secret).toBeDefined();
      expect(setupRes.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

      // 3. Confirm 2FA setup with valid code
      const validCode = generateSync({ secret: setupRes.body.secret });
      const confirmRes = await request(app)
        .post('/api/auth/2fa/confirm-setup')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: validCode });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.success).toBe(true);

      // 4. Next login should now require 2FA!
      const nextLoginRes = await request(app)
        .post('/api/auth/super-admin/login')
        .send({ email: 'super@toowix.com', password: superPassword });

      expect(nextLoginRes.status).toBe(200);
      expect(nextLoginRes.body.requires2FA).toBe(true);
    });
  });

  describe('Brute-Force Rate Limiting', () => {
    it('should block requests with 429 after 5 failed login attempts', async () => {
      // 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/super-admin/login')
          .send({ email: 'super@toowix.com', password: 'WrongPassword' });
      }

      // 6th attempt should be rate limited
      const rateLimitedRes = await request(app)
        .post('/api/auth/super-admin/login')
        .send({ email: 'super@toowix.com', password: 'WrongPassword' });

      expect(rateLimitedRes.status).toBe(429);
      expect(rateLimitedRes.body.error).toBe('TOO_MANY_ATTEMPTS');
      expect(rateLimitedRes.headers['retry-after']).toBeDefined();
    });
  });
});
