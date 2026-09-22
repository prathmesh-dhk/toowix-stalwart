import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../src/app';
import { AdminUserModel } from '../src/db/models/AdminUser';
import { RegistrationApplicationModel } from '../src/db/models/RegistrationApplication';
import { TenantModel } from '../src/db/models/Tenant';
import { DomainModel } from '../src/db/models/Domain';
import { MailboxModel } from '../src/db/models/Mailbox';
import { ActivationTokenModel } from '../src/db/models/ActivationToken';
import { hashPassword, hashSecurityAnswer } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';
import { StalwartError } from '../src/stalwart/errors';
import { generateSync } from 'otplib';
import crypto from 'crypto';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

describe('Forgot Password & Registration Security Options', () => {
  it('should accept registration with recoveryEmail and 3 security questions', async () => {
    const res = await request(app)
      .post('/api/public/register-tenant')
      .send({
        companyName: 'Acme Corp',
        requestedDomain: 'acmecorp.tech',
        applicantName: 'Alice Admin',
        contactEmail: 'alice@external.com',
        recoveryEmail: 'alice-recovery@gmail.com',
        securityQuestions: [
          { question: 'What was the name of your first pet?', answer: 'Fluffy' },
          { question: 'In what city was your first job?', answer: 'San Francisco' },
          { question: 'What was your childhood nickname?', answer: 'Ace' },
        ],
        password: 'Password123!',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const appDoc = await RegistrationApplicationModel.findOne({ requestedDomain: 'acmecorp.tech' });
    expect(appDoc).toBeTruthy();
    expect(appDoc?.recoveryEmail).toBe('alice-recovery@gmail.com');
    expect(appDoc?.securityQuestions?.length).toBe(3);
    // Answers must be hashed
    expect(appDoc?.securityQuestions?.[0].answerHash).not.toBe('Fluffy');
    expect(appDoc?.securityQuestions?.[0].answerHash).toBe(hashSecurityAnswer('Fluffy'));
  });

  it('should reject registration if duplicate security questions are selected', async () => {
    const res = await request(app)
      .post('/api/public/register-tenant')
      .send({
        companyName: 'Duplicate Corp',
        requestedDomain: 'duplicate.tech',
        applicantName: 'Bob Admin',
        contactEmail: 'bob@external.com',
        recoveryEmail: 'bob-recovery@gmail.com',
        securityQuestions: [
          { question: 'What was the name of your first pet?', answer: 'Dog' },
          { question: 'What was the name of your first pet?', answer: 'Cat' },
          { question: 'In what city was your first job?', answer: 'London' },
        ],
        password: 'Password123!',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  describe('Password Recovery Flows', () => {
    let testUserEmail = 'admin@acme.com';
    let recoveryEmail = 'recovery@external.com';

    beforeEach(async () => {
      const passwordHash = await hashPassword('OriginalPassword123!');
      await AdminUserModel.create({
        email: testUserEmail,
        passwordHash,
        role: 'TENANT_ADMIN',
        status: 'active',
        tenantId: new mongoose.Types.ObjectId(),
        twoFactorEnabled: false,
        recoveryEmail,
        securityQuestions: [
          { question: 'What was the name of your first pet?', answerHash: hashSecurityAnswer('Charlie') },
          { question: 'In what city was your first job?', answerHash: hashSecurityAnswer('New York') },
          { question: 'What primary school did you attend?', answerHash: hashSecurityAnswer('Lincoln Elementary') },
        ],
      });
    });

    it('should initiate forgot-password and return masked recovery email and question texts without answers', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password/initiate')
        .send({ email: testUserEmail });

      expect(res.status).toBe(200);
      expect(res.body.hasRecoveryEmail).toBe(true);
      expect(res.body.maskedRecoveryEmail).toContain('***');
      expect(res.body.hasSecurityQuestions).toBe(true);
      expect(res.body.securityQuestions).toHaveLength(3);
      expect(res.body.securityQuestions[0]).toBe('What was the name of your first pet?');
      // No answers should ever be present
      expect(JSON.stringify(res.body)).not.toContain('Charlie');
    });

    it('should send OTP and verify OTP to issue a resetToken, then reset password', async () => {
      // 1. Request OTP
      const sendRes = await request(app)
        .post('/api/auth/forgot-password/send-otp')
        .send({ email: testUserEmail });

      expect(sendRes.status).toBe(200);
      expect(sendRes.body.success).toBe(true);

      // Check DB for stored OTP
      const user = await AdminUserModel.findOne({ email: testUserEmail });
      expect(user?.passwordResetOtp?.codeHash).toBeTruthy();

      // Test with incorrect OTP
      const failVerify = await request(app)
        .post('/api/auth/forgot-password/verify-otp')
        .send({ email: testUserEmail, otp: '000000' });
      expect(failVerify.status).toBe(400);

      // We can manually set known OTP for testing verification
      const testOtp = '123456';
      user!.passwordResetOtp = {
        codeHash: crypto.createHash('sha256').update(testOtp).digest('hex'),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        attempts: 0,
      };
      await user!.save();

      // 2. Verify OTP
      const verifyRes = await request(app)
        .post('/api/auth/forgot-password/verify-otp')
        .send({ email: testUserEmail, otp: testOtp });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.resetToken).toBeTruthy();
      const resetToken = verifyRes.body.resetToken;

      // 3. Reset password
      const resetRes = await request(app)
        .post('/api/auth/forgot-password/reset')
        .send({ resetToken, newPassword: 'BrandNewPassword123!' });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.success).toBe(true);

      // 4. Verify login succeeds with new password
      const loginRes = await request(app)
        .post('/api/auth/tenant-admin/login')
        .send({ email: testUserEmail, password: 'BrandNewPassword123!' });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.token).toBeTruthy();
    });

    it('should verify security questions and issue a resetToken, then reset password', async () => {
      // 1. Test failed answer verification
      const failRes = await request(app)
        .post('/api/auth/forgot-password/verify-questions')
        .send({
          email: testUserEmail,
          answers: [
            { question: 'What was the name of your first pet?', answer: 'WrongPet' },
            { question: 'In what city was your first job?', answer: 'New York' },
            { question: 'What primary school did you attend?', answer: 'Lincoln Elementary' },
          ],
        });

      expect(failRes.status).toBe(400);
      expect(failRes.body.error).toBe('ANSWERS_INCORRECT');

      // 2. Test successful answer verification (case-insensitive & trimmed)
      const successRes = await request(app)
        .post('/api/auth/forgot-password/verify-questions')
        .send({
          email: testUserEmail,
          answers: [
            { question: 'What was the name of your first pet?', answer: '  charlie  ' },
            { question: 'In what city was your first job?', answer: 'new york' },
            { question: 'What primary school did you attend?', answer: 'lincoln elementary' },
          ],
        });

      expect(successRes.status).toBe(200);
      expect(successRes.body.resetToken).toBeTruthy();
      const resetToken = successRes.body.resetToken;

      // 3. Reset password with resetToken
      const resetRes = await request(app)
        .post('/api/auth/forgot-password/reset')
        .send({ resetToken, newPassword: 'SecurityQuestionsNewPass123!' });

      expect(resetRes.status).toBe(200);

      // 4. Verify login with new password
      const loginRes = await request(app)
        .post('/api/auth/tenant-admin/login')
        .send({ email: testUserEmail, password: 'SecurityQuestionsNewPass123!' });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.token).toBeTruthy();
    });

    it('should send OTP to current email when target="current" and verify successfully', async () => {
      // Request OTP to current email
      const sendRes = await request(app)
        .post('/api/auth/forgot-password/send-otp')
        .send({ email: testUserEmail, target: 'current' });

      expect(sendRes.status).toBe(200);
      expect(sendRes.body.success).toBe(true);
      expect(sendRes.body.target).toBe('current');
      expect(sendRes.body.maskedEmail).toBeDefined();

      const user = await AdminUserModel.findOne({ email: testUserEmail });
      expect(user?.passwordResetOtp?.codeHash).toBeTruthy();

      const knownOtp = '654321';
      user!.passwordResetOtp = {
        codeHash: crypto.createHash('sha256').update(knownOtp).digest('hex'),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        attempts: 0,
      };
      await user!.save();

      const verifyRes = await request(app)
        .post('/api/auth/forgot-password/verify-otp')
        .send({ email: testUserEmail, otp: knownOtp });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.resetToken).toBeTruthy();
    });

    it('should verify authenticator app TOTP code and issue a resetToken', async () => {
      const totpSecret = 'KVKFKRCPNZQUYMLXOVYDSQKJKZDTSRLD';
      await AdminUserModel.updateOne(
        { email: testUserEmail },
        { twoFactorEnabled: true, twoFactorSecret: totpSecret }
      );

      // Invalid code rejected
      const failRes = await request(app)
        .post('/api/auth/forgot-password/verify-totp')
        .send({ email: testUserEmail, code: '000000' });
      expect(failRes.status).toBe(400);
      expect(failRes.body.error).toBe('INVALID_TOTP');

      // Valid code accepted
      const validCode = generateSync({ secret: totpSecret });
      const successRes = await request(app)
        .post('/api/auth/forgot-password/verify-totp')
        .send({ email: testUserEmail, code: validCode });

      expect(successRes.status).toBe(200);
      expect(successRes.body.success).toBe(true);
      expect(successRes.body.resetToken).toBeTruthy();
    });

    it('should verify emergency backup code and issue a resetToken', async () => {
      const plainCode = 'ABCD-1234';
      const normalized = 'ABCD1234';
      const codeHash = hashSecurityAnswer(normalized);

      await AdminUserModel.updateOne(
        { email: testUserEmail },
        {
          backupCodes: [
            { codeHash, used: false },
            { codeHash: hashSecurityAnswer('EFGH5678'), used: true, usedAt: new Date() },
          ],
        }
      );

      // Verify initiate returns hasBackupCodes: true
      const initRes = await request(app)
        .post('/api/auth/forgot-password/initiate')
        .send({ email: testUserEmail });
      expect(initRes.status).toBe(200);
      expect(initRes.body.hasBackupCodes).toBe(true);

      // Invalid backup code rejected
      const failRes = await request(app)
        .post('/api/auth/forgot-password/verify-backup-code')
        .send({ email: testUserEmail, code: 'WRONG-CODE' });
      expect(failRes.status).toBe(400);
      expect(failRes.body.error).toBe('INVALID_BACKUP_CODE');

      // Already used backup code rejected
      const usedRes = await request(app)
        .post('/api/auth/forgot-password/verify-backup-code')
        .send({ email: testUserEmail, code: 'EFGH-5678' });
      expect(usedRes.status).toBe(400);
      expect(usedRes.body.error).toBe('INVALID_BACKUP_CODE');

      // Valid unused backup code accepted
      const successRes = await request(app)
        .post('/api/auth/forgot-password/verify-backup-code')
        .send({ email: testUserEmail, code: plainCode });

      expect(successRes.status).toBe(200);
      expect(successRes.body.success).toBe(true);
      expect(successRes.body.resetToken).toBeTruthy();

      // Ensure code marked as used
      const updatedUser = await AdminUserModel.findOne({ email: testUserEmail });
      const matched = updatedUser?.backupCodes?.find((b) => b.codeHash === codeHash);
      expect(matched?.used).toBe(true);

      // Subsequent attempt with same code fails
      const repeatRes = await request(app)
        .post('/api/auth/forgot-password/verify-backup-code')
        .send({ email: testUserEmail, code: plainCode });
      expect(repeatRes.status).toBe(400);
      expect(repeatRes.body.error).toBe('INVALID_BACKUP_CODE');
    });

    it('returns 400 with PASSWORD_TOO_WEAK when Stalwart rejects password during reset, preserving reset token', async () => {
      // Find tenant for test user
      const user = await AdminUserModel.findOne({ email: testUserEmail });
      expect(user).toBeTruthy();

      // Create a mailbox row for testUserEmail with a stalwartAccountId
      await MailboxModel.create({
        tenantId: user!.tenantId,
        domainId: new mongoose.Types.ObjectId(),
        localPart: 'admin',
        address: testUserEmail,
        stalwartAccountId: 'acc-test-stalwart-123',
        status: 'active',
      });

      // Prepare OTP and resetToken
      const testOtp = '654321';
      user!.passwordResetOtp = {
        codeHash: crypto.createHash('sha256').update(testOtp).digest('hex'),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        attempts: 0,
      };
      await user!.save();

      const verifyRes = await request(app)
        .post('/api/auth/forgot-password/verify-otp')
        .send({ email: testUserEmail, otp: testOtp });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.resetToken).toBeTruthy();
      const resetToken = verifyRes.body.resetToken;

      // Mock Stalwart to reject with weak password
      const stalwartSpy = vi.spyOn(stalwartClient, 'updateAccountPassword').mockRejectedValueOnce(
        new StalwartError(
          "Failed to update password in Stalwart: Password is too weak. This is similar to a commonly used password. Add another word or two. Uncommon words are better. Capitalization doesn't help very much.",
          'PASSWORD_UPDATE_FAILED',
          {
            description: "Password is too weak. This is similar to a commonly used password. Add another word or two. Uncommon words are better. Capitalization doesn't help very much.",
          }
        )
      );

      const oldHash = user!.passwordHash;

      // 1. Attempt reset with weak password
      const resetRes = await request(app)
        .post('/api/auth/forgot-password/reset')
        .send({ resetToken, newPassword: 'WeakCommonPassword123!' });

      expect(resetRes.status).toBe(400);
      expect(resetRes.body.error).toBe('PASSWORD_TOO_WEAK');
      expect(resetRes.body.message).toContain('Password is too weak');

      // Ensure MongoDB user was NOT updated and reset token was NOT consumed
      const userAfterFail = await AdminUserModel.findOne({ email: testUserEmail });
      expect(userAfterFail?.passwordHash).toBe(oldHash);
      expect(userAfterFail?.passwordResetToken).toBeTruthy();

      // 2. Now attempt reset with strong password (mock Stalwart accepting it)
      stalwartSpy.mockResolvedValueOnce();

      const successResetRes = await request(app)
        .post('/api/auth/forgot-password/reset')
        .send({ resetToken, newPassword: 'SuperStrongUniquePass2026!' });

      expect(successResetRes.status).toBe(200);
      expect(successResetRes.body.success).toBe(true);

      // Verify user hash has now updated and resetToken is consumed
      const userAfterSuccess = await AdminUserModel.findOne({ email: testUserEmail });
      expect(userAfterSuccess?.passwordHash).not.toBe(oldHash);
      expect(userAfterSuccess?.passwordResetToken?.tokenHash).toBeFalsy();
    });
  });
});

