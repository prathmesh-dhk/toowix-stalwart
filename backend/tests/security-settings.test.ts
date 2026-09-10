import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../src/app';
import { AdminUserModel } from '../src/db/models/AdminUser';
import { TenantModel } from '../src/db/models/Tenant';
import { generateOidcToken, hashPassword, hashSecurityAnswer } from '../src/auth/service';
import { emailService } from '../src/services/email.service';

describe('Account Security & Recovery Email Settings API Tests', () => {
  let mongod: MongoMemoryServer;
  let tenantId: string;
  let adminId: string;
  let adminToken: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);

    vi.spyOn(emailService, 'sendRecoveryEmailVerificationOtpEmail').mockResolvedValue({ success: true, messageId: 'msg-rec-1' });
    vi.spyOn(emailService, 'sendLogin2FaOtpEmail').mockResolvedValue({ success: true, messageId: 'msg-2fa-1' });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await AdminUserModel.deleteMany({});
    await TenantModel.deleteMany({});

    const tenant = await TenantModel.create({
      name: 'Security Test Org',
      contactEmail: 'admin@secorg.com',
      status: 'active',
      mailboxLimit: 10,
      mailboxCount: 0,
    });
    tenantId = tenant._id.toString();

    const passwordHash = await hashPassword('SecretPass123!');
    const admin = await AdminUserModel.create({
      email: 'admin@secorg.com',
      passwordHash,
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
      status: 'active',
      twoFactorEnabled: false,
    });
    adminId = admin._id.toString();

    adminToken = generateOidcToken({
      id: adminId,
      email: 'admin@secorg.com',
      role: 'TENANT_ADMIN',
      tenantId,
      twoFactorEnabled: false,
    });
  });

  it('GET /api/auth/security/settings returns initial security profile', async () => {
    const res = await request(app)
      .get('/api/auth/security/settings')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('admin@secorg.com');
    expect(res.body.recoveryEmail).toBeNull();
    expect(res.body.twoFactorEnabled).toBe(false);
    expect(res.body.hasTotpConfigured).toBe(false);
  });

  it('POST /api/auth/security/recovery-email/send-otp sends verification OTP to recovery email', async () => {
    const res = await request(app)
      .post('/api/auth/security/recovery-email/send-otp')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'backup-owner@gmail.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const user = await AdminUserModel.findById(adminId);
    expect(user?.recoveryEmailOtp).toBeDefined();
    expect(user?.recoveryEmailOtp?.email).toBe('backup-owner@gmail.com');
    expect(emailService.sendRecoveryEmailVerificationOtpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'backup-owner@gmail.com' })
    );
  });

  it('POST /api/auth/security/recovery-email/verify-otp verifies code and updates recovery email', async () => {
    const otpCode = '123456';
    await AdminUserModel.findByIdAndUpdate(adminId, {
      recoveryEmailOtp: {
        email: 'backup-owner@gmail.com',
        codeHash: hashSecurityAnswer(otpCode),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        attempts: 0,
      },
    });

    // Test incorrect code
    const badRes = await request(app)
      .post('/api/auth/security/recovery-email/verify-otp')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: '999999' });

    expect(badRes.status).toBe(400);
    expect(badRes.body.error).toBe('INVALID_CODE');

    // Test correct code
    const okRes = await request(app)
      .post('/api/auth/security/recovery-email/verify-otp')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: '123456' });

    expect(okRes.status).toBe(200);
    expect(okRes.body.success).toBe(true);
    expect(okRes.body.recoveryEmail).toBe('backup-owner@gmail.com');

    const updatedUser = await AdminUserModel.findById(adminId);
    expect(updatedUser?.recoveryEmail).toBe('backup-owner@gmail.com');
    expect(updatedUser?.recoveryEmailOtp?.codeHash).toBeFalsy();
  });

  it('DELETE /api/auth/security/recovery-email removes recovery email', async () => {
    await AdminUserModel.findByIdAndUpdate(adminId, { recoveryEmail: 'backup-owner@gmail.com' });

    const res = await request(app)
      .delete('/api/auth/security/recovery-email')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updatedUser = await AdminUserModel.findById(adminId);
    expect(updatedUser?.recoveryEmail).toBeNull();
  });

  it('POST /api/auth/security/2fa/mode toggles 2FA between email, disabled, and checks totp requirement', async () => {
    // Attempting TOTP before setting secret should fail
    const badTotpRes = await request(app)
      .post('/api/auth/security/2fa/mode')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'totp' });

    expect(badTotpRes.status).toBe(400);
    expect(badTotpRes.body.error).toBe('TOTP_NOT_CONFIGURED');

    // Switching to email 2FA should succeed immediately using account email
    const emailRes = await request(app)
      .post('/api/auth/security/2fa/mode')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'email' });

    expect(emailRes.status).toBe(200);
    expect(emailRes.body.twoFactorEnabled).toBe(true);
    expect(emailRes.body.twoFactorMethod).toBe('email');

    let user = await AdminUserModel.findById(adminId);
    expect(user?.twoFactorEnabled).toBe(true);
    expect(user?.twoFactorMethod).toBe('email');

    // Disabling 2FA should succeed
    const disableRes = await request(app)
      .post('/api/auth/security/2fa/mode')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'disabled' });

    expect(disableRes.status).toBe(200);
    expect(disableRes.body.twoFactorEnabled).toBe(false);

    user = await AdminUserModel.findById(adminId);
    expect(user?.twoFactorEnabled).toBe(false);
  });

  it('Login with email 2FA auto-dispatches OTP to registered account email', async () => {
    // Set user with email 2FA enabled
    await AdminUserModel.findByIdAndUpdate(adminId, {
      twoFactorEnabled: true,
      twoFactorMethod: 'email',
    });

    const loginRes = await request(app)
      .post('/api/auth/tenant-admin/login')
      .send({
        email: 'admin@secorg.com',
        password: 'SecretPass123!',
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.requires2FA).toBe(true);
    expect(loginRes.body.defaultMethod).toBe('email');
    expect(loginRes.body.tempToken).toBeDefined();

    expect(emailService.sendLogin2FaOtpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@secorg.com' })
    );
  });
});
