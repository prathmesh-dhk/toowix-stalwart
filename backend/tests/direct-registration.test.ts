import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../src/app';
import { AdminUserModel } from '../src/db/models/AdminUser';
import { TenantModel } from '../src/db/models/Tenant';
import { generateContactEmailVerificationToken } from '../src/auth/service';
import { resetContactEmailOtpStore } from '../src/api/public.routes';

describe('Direct Self-Service Registration Flow', () => {
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
    await AdminUserModel.deleteMany({});
    await TenantModel.deleteMany({});
    resetContactEmailOtpStore();
  });

  it('sends OTP to email and rejects if email is already registered', async () => {
    // 1. Send OTP to new email
    const sendRes = await request(app)
      .post('/api/public/contact-email/send-otp')
      .send({ email: 'newadmin@enterprise.org' });

    expect(sendRes.status).toBe(200);
    expect(sendRes.body.success).toBe(true);

    // 2. Create an existing tenant and admin user
    const existingTenant = await TenantModel.create({
      name: 'Existing Enterprise',
      contactEmail: 'existing@enterprise.org',
      status: 'active',
    });

    await AdminUserModel.create({
      email: 'existing@enterprise.org',
      passwordHash: 'dummyhash',
      role: 'TENANT_ADMIN',
      tenantId: existingTenant._id,
      status: 'active',
      twoFactorEnabled: false,
    });

    // 3. Try to send OTP to already registered email
    const duplicateRes = await request(app)
      .post('/api/public/contact-email/send-otp')
      .send({ email: 'existing@enterprise.org' });

    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.error).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('rejects registration with invalid or mismatched verification token', async () => {
    const res = await request(app)
      .post('/api/public/register')
      .send({
        email: 'user@domain.com',
        emailVerificationToken: 'invalid.token.here',
        password: 'Password123!',
        securityQuestions: [
          { question: 'What was the name of your first pet?', answer: 'Fluffy' },
          { question: 'In what city were you born?', answer: 'Metropolis' },
          { question: 'What was your high school mascot?', answer: 'Eagles' },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_VERIFICATION_TOKEN');
  });

  it('rejects registration if non-unique security questions are provided', async () => {
    const token = generateContactEmailVerificationToken('user@domain.com');

    const res = await request(app)
      .post('/api/public/register')
      .send({
        email: 'user@domain.com',
        emailVerificationToken: token,
        password: 'Password123!',
        securityQuestions: [
          { question: 'What was the name of your first pet?', answer: 'Fluffy' },
          { question: 'What was the name of your first pet?', answer: 'Rex' }, // duplicate question!
          { question: 'What was your high school mascot?', answer: 'Eagles' },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('completes registration, provisions tenant & admin user, and allows immediate login without activation link', async () => {
    const email = 'alex.founder@startup.io';
    const password = 'SuperSecretPassword123!';
    const token = generateContactEmailVerificationToken(email);

    // 1. Register
    const regRes = await request(app)
      .post('/api/public/register')
      .send({
        email,
        emailVerificationToken: token,
        password,
        securityQuestions: [
          { question: 'What was the name of your first pet?', answer: 'Sparky' },
          { question: 'In what city were you born?', answer: 'Austin' },
          { question: 'What was your high school mascot?', answer: 'Tigers' },
        ],
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.success).toBe(true);
    expect(regRes.body.user.email).toBe(email);

    // 2. Verify database records
    const userDoc = await AdminUserModel.findOne({ email });
    expect(userDoc).toBeDefined();
    expect(userDoc?.role).toBe('TENANT_ADMIN');
    expect(userDoc?.status).toBe('active');
    expect(userDoc?.twoFactorEnabled).toBe(false);
    expect(userDoc?.securityQuestions).toHaveLength(3);

    const tenantDoc = await TenantModel.findById(userDoc?.tenantId);
    expect(tenantDoc).toBeDefined();
    expect(tenantDoc?.status).toBe('active');
    expect(tenantDoc?.contactEmail).toBe(email);

    // 3. Directly log in without activation link or 2FA!
    const loginRes = await request(app)
      .post('/api/auth/tenant-admin/login')
      .send({
        email,
        password,
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.requires2FA).toBe(false);
    expect(loginRes.body.token).toBeDefined();
    expect(loginRes.body.user.email).toBe(email);
    expect(loginRes.body.user.role).toBe('TENANT_ADMIN');
  });

  it('accepts single-character security question answers', async () => {
    const email = 'singlechar@startup.io';
    const password = 'SuperSecretPassword123!';
    const token = generateContactEmailVerificationToken(email);

    const regRes = await request(app)
      .post('/api/public/register')
      .send({
        email,
        emailVerificationToken: token,
        password,
        securityQuestions: [
          { question: 'What was the name of your first pet?', answer: 'A' },
          { question: 'In what city were you born?', answer: 'B' },
          { question: 'What was your high school mascot?', answer: 'C' },
        ],
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.success).toBe(true);

    const userDoc = await AdminUserModel.findOne({ email });
    expect(userDoc?.securityQuestions).toHaveLength(3);
  });
});
