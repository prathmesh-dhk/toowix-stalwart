import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../src/app';
import { AdminUserModel } from '../src/db/models/AdminUser';
import { TenantModel } from '../src/db/models/Tenant';
import { generateOidcToken, hashPassword } from '../src/auth/service';
import { emailService } from '../src/services/email.service';

describe('2FA Emergency Backup Codes API Tests', () => {
  let mongod: MongoMemoryServer;
  let tenantId: string;
  let adminId: string;
  let adminToken: string;
  let sendBackupCodesSpy: any;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);

    sendBackupCodesSpy = vi.spyOn(emailService, 'sendBackupCodesEmail').mockResolvedValue({
      success: true,
      messageId: 'msg-backup-codes-test',
    });
    vi.spyOn(emailService, 'sendLogin2FaOtpEmail').mockResolvedValue({
      success: true,
      messageId: 'msg-otp-test',
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    sendBackupCodesSpy.mockClear();
    await AdminUserModel.deleteMany({});
    await TenantModel.deleteMany({});

    const tenant = await TenantModel.create({
      name: 'Backup Codes Org',
      contactEmail: 'admin@backuporg.com',
      status: 'active',
      mailboxLimit: 10,
      mailboxCount: 0,
    });
    tenantId = tenant._id.toString();

    const passwordHash = await hashPassword('SecretPass123!');
    const admin = await AdminUserModel.create({
      email: 'admin@backuporg.com',
      passwordHash,
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
      status: 'active',
      twoFactorEnabled: false,
    });
    adminId = admin._id.toString();

    adminToken = generateOidcToken({
      id: adminId,
      email: 'admin@backuporg.com',
      role: 'TENANT_ADMIN',
      tenantId,
      twoFactorEnabled: false,
    });
  });

  it('enabling 2FA generates 10 backup codes, emails them, and returns them', async () => {
    const res = await request(app)
      .post('/api/auth/security/2fa/mode')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'email' });

    expect(res.status).toBe(200);
    expect(res.body.twoFactorEnabled).toBe(true);
    expect(res.body.backupCodes).toHaveLength(10);
    expect(res.body.remainingBackupCodes).toBe(10);
    expect(res.body.backupCodes[0]).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/);

    expect(sendBackupCodesSpy).toHaveBeenCalledTimes(1);
    expect(sendBackupCodesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@backuporg.com',
        backupCodes: expect.arrayContaining([res.body.backupCodes[0]]),
      })
    );

    // Verify GET /api/auth/security/settings shows remainingBackupCodes: 10
    const settingsRes = await request(app)
      .get('/api/auth/security/settings')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(settingsRes.status).toBe(200);
    expect(settingsRes.body.remainingBackupCodes).toBe(10);
  });

  it('login with 2FA enabled allows bypassing 2FA with a single-use backup code', async () => {
    // Enable 2FA
    const setupRes = await request(app)
      .post('/api/auth/security/2fa/mode')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'email' });
    const backupCodes: string[] = setupRes.body.backupCodes;
    const testCode = backupCodes[0];

    // Attempt login
    const loginRes = await request(app)
      .post('/api/auth/tenant-admin/login')
      .send({ email: 'admin@backuporg.com', password: 'SecretPass123!' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.requires2FA).toBe(true);
    expect(loginRes.body.hasBackupCodes).toBe(true);
    expect(loginRes.body.remainingBackupCodes).toBe(10);
    const tempToken = loginRes.body.tempToken;

    // Verify 2FA using lowercase version with spaces (should normalize and match)
    const formattedCode = testCode.toLowerCase().replace('-', ' ');
    const verifyRes = await request(app)
      .post('/api/auth/2fa/verify')
      .send({
        tempToken,
        code: formattedCode,
        method: 'backup_code',
      });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.token).toBeDefined();
    expect(verifyRes.body.user.email).toBe('admin@backuporg.com');

    // Trying the same code again on a new login attempt should fail (single-use)
    const secondLoginRes = await request(app)
      .post('/api/auth/tenant-admin/login')
      .send({ email: 'admin@backuporg.com', password: 'SecretPass123!' });
    const secondTempToken = secondLoginRes.body.tempToken;

    const reuseRes = await request(app)
      .post('/api/auth/2fa/verify')
      .send({
        tempToken: secondTempToken,
        code: testCode,
        method: 'backup_code',
      });

    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.message).toContain('Invalid or previously used backup code');

    // But using the second code (backupCodes[1]) works
    const validSecondRes = await request(app)
      .post('/api/auth/2fa/verify')
      .send({
        tempToken: secondTempToken,
        code: backupCodes[1],
        method: 'backup_code',
      });

    expect(validSecondRes.status).toBe(200);
    expect(validSecondRes.body.token).toBeDefined();

    // Check remaining backup codes count is now 8
    const updatedUser = await AdminUserModel.findById(adminId);
    const unused = updatedUser?.backupCodes?.filter((c) => !c.used);
    expect(unused).toHaveLength(8);
  });

  it('regenerate backup codes invalidates old codes and provides 10 new ones', async () => {
    // Enable 2FA
    const setupRes = await request(app)
      .post('/api/auth/security/2fa/mode')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'email' });
    const oldCodes: string[] = setupRes.body.backupCodes;

    sendBackupCodesSpy.mockClear();

    // Regenerate
    const regenRes = await request(app)
      .post('/api/auth/security/2fa/backup-codes/regenerate')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(regenRes.status).toBe(200);
    expect(regenRes.body.backupCodes).toHaveLength(10);
    expect(regenRes.body.remainingBackupCodes).toBe(10);
    expect(sendBackupCodesSpy).toHaveBeenCalledTimes(1);

    const newCodes: string[] = regenRes.body.backupCodes;

    // Login and verify old code is rejected
    const loginRes = await request(app)
      .post('/api/auth/tenant-admin/login')
      .send({ email: 'admin@backuporg.com', password: 'SecretPass123!' });
    const tempToken = loginRes.body.tempToken;

    const oldCodeAttempt = await request(app)
      .post('/api/auth/2fa/verify')
      .send({
        tempToken,
        code: oldCodes[0],
        method: 'backup_code',
      });
    expect(oldCodeAttempt.status).toBe(401);

    // New code works
    const newCodeAttempt = await request(app)
      .post('/api/auth/2fa/verify')
      .send({
        tempToken,
        code: newCodes[0],
        method: 'backup_code',
      });
    expect(newCodeAttempt.status).toBe(200);
  });
});
