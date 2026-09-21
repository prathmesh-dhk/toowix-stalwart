import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../src/app';
import { AdminUserModel } from '../src/db/models/AdminUser';
import { TenantModel } from '../src/db/models/Tenant';
import { DomainModel } from '../src/db/models/Domain';
import { MailboxModel } from '../src/db/models/Mailbox';
import { BlockedRegistrationIdentityModel } from '../src/db/models/BlockedRegistrationIdentity';
import { generateRecoveryEmailVerificationToken } from '../src/auth/service';
import { resetRecoveryEmailOtpStore, resetRegistrationRateLimitStore } from '../src/api/public.routes';
import { seedPlatformIdentityDomain } from '../src/db/seed';
import { stalwartClient } from '../src/stalwart/client';
import { emailService } from '../src/services/email.service';
import { config } from '../src/config';

const SECURITY_QUESTIONS = [
  { question: 'First pet name?', answer: 'rex' },
  { question: 'Favourite teacher?', answer: 'smith' },
  { question: 'Street you grew up on?', answer: 'elm' },
];

const RECOVERY = 'prathmesh.personal@gmail.com';

describe('Direct Self-Service Registration (username on the platform domain)', () => {
  let mongod: MongoMemoryServer;

  /** Everything /register needs except the username. */
  const body = (username: string, extra: Record<string, unknown> = {}) => ({
    username,
    password: 'Password123!',
    recoveryEmail: RECOVERY,
    recoveryEmailVerificationToken: generateRecoveryEmailVerificationToken(RECOVERY),
    securityQuestions: SECURITY_QUESTIONS,
    ...extra,
  });

  const availability = (username: string) =>
    request(app).get(`/api/public/username-availability?username=${encodeURIComponent(username)}`);

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([
      AdminUserModel.deleteMany({}),
      TenantModel.deleteMany({}),
      DomainModel.deleteMany({}),
      MailboxModel.deleteMany({}),
      BlockedRegistrationIdentityModel.deleteMany({}),
    ]);
    resetRecoveryEmailOtpStore();
    await resetRegistrationRateLimitStore();

    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([]);
    vi.spyOn(stalwartClient, 'createDomain').mockResolvedValue({ id: 'stalwart-dom-platform', name: config.platformMailDomain });
    vi.spyOn(stalwartClient, 'createAccount').mockResolvedValue({ id: 'stalwart-acc-1', name: 'x' } as any);
    vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();
    vi.spyOn(emailService, 'sendRecoveryEmailVerificationOtpEmail').mockResolvedValue({ success: true } as any);

    // The platform identity domain must exist before anyone can take a username on it.
    await seedPlatformIdentityDomain();
  });

  describe('username availability', () => {
    it('accepts a free username and reports the address it will create', async () => {
      const res = await availability('prathmesh');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ available: true, address: `prathmesh@${config.platformMailDomain}` });
    });

    it.each([
      ['too short', 'ab'],
      ['starts with a dot', '.leading'],
      ['has a space', 'two words'],
      ['has a plus (would collapse onto another identity)', 'user+tag'],
      ['uppercase is normalised but still must be valid', '!!!'],
    ])('refuses a malformed username (%s)', async (_label, username) => {
      const res = await availability(username);
      expect(res.status).toBe(200);
      expect(res.body.available).toBe(false);
      expect(res.body.reason).toBeTruthy();
    });

    it('refuses reserved names', async () => {
      for (const name of ['postmaster', 'abuse', 'admin', 'noreply', 'support']) {
        const res = await availability(name);
        expect(res.body.available, name).toBe(false);
        expect(res.body.reason).toMatch(/reserved/i);
      }
    });

    it('reports a username taken once it is registered', async () => {
      expect((await request(app).post('/api/public/register').send(body('prathmesh'))).status).toBe(201);

      const res = await availability('prathmesh');
      expect(res.body.available).toBe(false);
    });

    it('reports a burned username as taken, and does not log the probe as a refused attempt', async () => {
      await BlockedRegistrationIdentityModel.create({
        emailNormalized: `gone@${config.platformMailDomain}`,
        originalEmail: `gone@${config.platformMailDomain}`,
        deletionId: new mongoose.Types.ObjectId(),
      });

      const res = await availability('gone');
      expect(res.body.available).toBe(false);
      // The probe runs on every keystroke — it must not bury real refusals in the audit record.
      expect(await BlockedRegistrationIdentityModel.countDocuments({})).toBe(1);
    });
  });

  describe('registration', () => {
    it('creates the tenant, the admin and a real mailbox, then allows immediate login', async () => {
      const res = await request(app).post('/api/public/register').send(body('prathmesh'));

      expect(res.status).toBe(201);
      const loginEmail = `prathmesh@${config.platformMailDomain}`;
      expect(res.body.user.email).toBe(loginEmail);

      // Login identity is the platform address; recovery is the verified external one.
      const admin = await AdminUserModel.findOne({ email: loginEmail });
      expect(admin).not.toBeNull();
      expect(admin!.recoveryEmail).toBe(RECOVERY);
      expect(admin!.role).toBe('TENANT_ADMIN');
      expect(admin!.securityQuestions).toHaveLength(3);

      // contactEmail must be the EXTERNAL address — Stripe receipts and dunning go there.
      const tenant = await TenantModel.findById(admin!.tenantId);
      expect(tenant!.contactEmail).toBe(RECOVERY);
      expect(tenant!.status).toBe('active');

      // The mailbox is real: a row plus a Stalwart account.
      const mailbox = await MailboxModel.findOne({ address: loginEmail });
      expect(mailbox).not.toBeNull();
      expect(mailbox!.stalwartAccountId).toBe('stalwart-acc-1');
      expect(stalwartClient.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'prathmesh', password: 'Password123!' })
      );

      // It hangs off the platform tenant, not the customer's — no seat billing, no quota.
      expect(mailbox!.tenantId.toString()).not.toBe(tenant!._id.toString());

      const login = await request(app)
        .post('/api/auth/tenant-admin/login')
        .send({ email: loginEmail, password: 'Password123!' });
      expect(login.status).toBe(200);
    });

    it('walks the real recovery-email OTP endpoints end to end', async () => {
      let sentCode = '';
      vi.spyOn(emailService, 'sendRecoveryEmailVerificationOtpEmail').mockImplementation(async (params: any) => {
        sentCode = params.otpCode;
        return { success: true } as any;
      });

      expect((await request(app).post('/api/public/recovery-email/send-otp').send({ email: RECOVERY })).status).toBe(200);
      expect(sentCode).toMatch(/^\d{6}$/);

      const verify = await request(app)
        .post('/api/public/recovery-email/verify-otp')
        .send({ email: RECOVERY, code: sentCode });
      expect(verify.status).toBe(200);

      const res = await request(app)
        .post('/api/public/register')
        .send(body('prathmesh', { recoveryEmailVerificationToken: verify.body.verificationToken }));
      expect(res.status).toBe(201);
    });

    it('refuses an unverified or mismatched recovery email, creating nothing', async () => {
      const missing = await request(app)
        .post('/api/public/register')
        .send({ ...body('prathmesh'), recoveryEmailVerificationToken: 'not-a-token' });
      expect(missing.status).toBe(400);
      expect(missing.body.error).toBe('INVALID_VERIFICATION_TOKEN');

      // A token for a DIFFERENT address must not authorise this one.
      const mismatched = await request(app)
        .post('/api/public/register')
        .send({ ...body('prathmesh'), recoveryEmailVerificationToken: generateRecoveryEmailVerificationToken('someone.else@gmail.com') });
      expect(mismatched.status).toBe(400);

      expect(await AdminUserModel.countDocuments({})).toBe(0);
      expect(await MailboxModel.countDocuments({})).toBe(0);
    });

    it('refuses a taken username without touching the existing account', async () => {
      expect((await request(app).post('/api/public/register').send(body('prathmesh'))).status).toBe(201);

      const res = await request(app).post('/api/public/register').send(body('prathmesh'));
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('USERNAME_TAKEN');
      expect(await AdminUserModel.countDocuments({})).toBe(1);
      expect(await MailboxModel.countDocuments({})).toBe(1);
    });

    it('refuses a reserved or malformed username', async () => {
      for (const username of ['postmaster', 'ab', 'bad name']) {
        const res = await request(app).post('/api/public/register').send(body(username));
        expect(res.status, username).toBe(400);
      }
      expect(await AdminUserModel.countDocuments({})).toBe(0);
    });

    it('refuses a burned username', async () => {
      await BlockedRegistrationIdentityModel.create({
        emailNormalized: `gone@${config.platformMailDomain}`,
        originalEmail: `gone@${config.platformMailDomain}`,
        deletionId: new mongoose.Types.ObjectId(),
      });

      const res = await request(app).post('/api/public/register').send(body('gone'));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('REGISTRATION_EMAIL_BLOCKED');
    });

    it('surfaces a mail-server password rejection as a 400, leaving no half-made account', async () => {
      vi.spyOn(stalwartClient, 'createAccount').mockRejectedValue(new Error('password is too weak'));

      const res = await request(app).post('/api/public/register').send(body('prathmesh'));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('PASSWORD_TOO_WEAK');

      expect(await MailboxModel.countDocuments({})).toBe(0);
      expect(await AdminUserModel.countDocuments({})).toBe(0);
      expect(await TenantModel.countDocuments({ contactEmail: RECOVERY })).toBe(0);
    });

    it('uses the supplied organization name, and falls back to the username', async () => {
      expect(
        (await request(app).post('/api/public/register').send(body('prathmesh', { organizationName: 'Wayne Enterprises Global' }))).status
      ).toBe(201);
      const named = await TenantModel.findOne({ contactEmail: RECOVERY });
      expect(named!.name).toBe('Wayne Enterprises Global');

      await AdminUserModel.deleteMany({});
      await TenantModel.deleteMany({});
      await MailboxModel.deleteMany({});

      expect((await request(app).post('/api/public/register').send(body('bruce'))).status).toBe(201);
      const derived = await TenantModel.findOne({ contactEmail: RECOVERY });
      expect(derived!.name).toBe("Bruce's Organization");
    });

    it('still requires three distinct security questions', async () => {
      const res = await request(app)
        .post('/api/public/register')
        .send(
          body('prathmesh', {
            securityQuestions: [
              { question: 'First pet name?', answer: 'rex' },
              { question: 'First pet name?', answer: 'rex' },
              { question: 'Favourite teacher?', answer: 'smith' },
            ],
          })
        );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });
});
