import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../src/app';
import {
  TenantModel,
  AdminUserModel,
  DomainModel,
  MailboxModel,
  OrganisationDeletionModel,
  BlockedRegistrationIdentityModel,
  RegistrationApplicationModel,
} from '../src/db/models';
import { generateOidcToken, generateRecoveryEmailVerificationToken } from '../src/auth/service';
import { emailService } from '../src/services/email.service';
import { resetRegistrationRateLimitStore } from '../src/api/public.routes';
import { normalizeRegistrationEmail } from '../src/utils/email-identity';
import { seedPlatformIdentityDomain } from '../src/db/seed';
import { stalwartClient } from '../src/stalwart/client';
import { config } from '../src/config';

const SECURITY_QUESTIONS = [
  { question: 'First pet name?', answer: 'rex' },
  { question: 'Favourite teacher?', answer: 'smith' },
  { question: 'Street you grew up on?', answer: 'elm' },
];

describe('permanent registration-email block after an organisation is deleted', () => {
  let mongod: MongoMemoryServer;
  let deletionId: mongoose.Types.ObjectId;
  let otpMail: ReturnType<typeof vi.spyOn>;

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
    await Promise.all(
      [TenantModel, AdminUserModel, OrganisationDeletionModel, BlockedRegistrationIdentityModel, RegistrationApplicationModel].map((m) =>
        (m as mongoose.Model<any>).deleteMany({})
      )
    );
    await resetRegistrationRateLimitStore();

    otpMail = vi.spyOn(emailService, 'sendContactEmailVerificationOtpEmail').mockResolvedValue({ success: true });
    // Geo for the blocked-attempt log; the supertest client is loopback so no network is used, but be safe.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled in tests'));

    // A previously deleted organisation: its record + the block it left behind. Tenant and admin are gone.
    const record = await OrganisationDeletionModel.create({
      tenantId: new mongoose.Types.ObjectId(),
      organisationName: 'Acme Corp',
      registrationEmail: 'Owner@Acme.com',
      registrationEmailNormalized: 'owner@acme.com',
      domains: ['acme.com'],
      organisationCreatedAt: new Date('2026-01-01'),
      previousTenantStatus: 'active',
      stage: 'completed',
      initiatedAt: new Date('2026-09-01'),
      completedAt: new Date('2026-09-11'),
      suspensionEndsAt: new Date('2026-09-08'),
      initiatedBy: { userId: 'u1', email: 'owner@acme.com', role: 'TENANT_ADMIN', organisationId: 'o1', organisationName: 'Acme Corp' },
      initiatedNetwork: { ip: '203.0.113.7' },
    });
    deletionId = record._id;
    await BlockedRegistrationIdentityModel.create({ emailNormalized: 'owner@acme.com', originalEmail: 'Owner@Acme.com', deletionId, blockedAt: new Date('2026-09-11') });
  });

  const sendOtp = (email: string) => request(app).post('/api/public/contact-email/send-otp').send({ email });

  describe('registration OTP request (the first step of self-service sign-up)', () => {
    it.each([
      ['the exact email', 'owner@acme.com'],
      ['different casing', 'OWNER@ACME.COM'],
      ['a +tag alias', 'owner+second@acme.com'],
    ])('blocks %s', async (_label, email) => {
      const res = await sendOtp(email);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('REGISTRATION_EMAIL_BLOCKED');
      expect(otpMail).not.toHaveBeenCalled();
    });

    it('collapses gmail dots and the googlemail alias', async () => {
      await BlockedRegistrationIdentityModel.create({ emailNormalized: 'janedoe@gmail.com', originalEmail: 'Jane.Doe@gmail.com', deletionId });
      for (const variant of ['jane.doe@gmail.com', 'j.a.n.e.d.o.e@gmail.com', 'janedoe@googlemail.com', 'JaneDoe+x@Gmail.com']) {
        const res = await sendOtp(variant);
        expect(res.status, variant).toBe(403);
      }
    });

    it('does not block unrelated emails, even at the same domain', async () => {
      const res = await sendOtp('someone.else@acme.com');
      expect(res.status).toBe(200);
      expect(otpMail).toHaveBeenCalledTimes(1);
    });

    it('logs each blocked attempt on the deleted organisation\'s record, without unbounded growth', async () => {
      for (let i = 0; i < 3; i++) await sendOtp('owner@acme.com');
      let record = await OrganisationDeletionModel.findById(deletionId);
      expect(record!.reRegistration.blockedAttempts).toHaveLength(3);
      expect(record!.reRegistration.blockedAttempts[0]).toMatchObject({ source: 'contact-email/send-otp' });
      expect(record!.reRegistration.blockedAttempts[0].ip).toBeTruthy();

      for (let i = 0; i < 120; i++) await sendOtp('owner@acme.com');
      record = await OrganisationDeletionModel.findById(deletionId);
      expect(record!.reRegistration.blockedAttempts.length).toBeLessThanOrEqual(100);
    });
  });

  // Self-service signup no longer uses an external email as the registration identity — the identity
  // is now the username on the platform domain, so that is what a deletion burns.
  describe('direct self-service registration (username identity)', () => {
    const register = (username: string, recoveryEmail: string) =>
      request(app)
        .post('/api/public/register')
        .send({
          username,
          password: 'Password123!',
          recoveryEmail,
          recoveryEmailVerificationToken: generateRecoveryEmailVerificationToken(recoveryEmail),
          securityQuestions: SECURITY_QUESTIONS,
        });

    beforeEach(async () => {
      await Promise.all([DomainModel.deleteMany({}), MailboxModel.deleteMany({})]);
      vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([]);
      vi.spyOn(stalwartClient, 'createDomain').mockResolvedValue({ id: 'dom-1', name: config.platformMailDomain });
      vi.spyOn(stalwartClient, 'createAccount').mockResolvedValue({ id: 'acc-1', name: 'x' } as any);
      await seedPlatformIdentityDomain();
    });

    it('refuses a username burned by an earlier deletion', async () => {
      await BlockedRegistrationIdentityModel.create({
        emailNormalized: `oldowner@${config.platformMailDomain}`,
        originalEmail: `oldowner@${config.platformMailDomain}`,
        deletionId,
      });

      const res = await register('oldowner', 'someone@fresh.com');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('REGISTRATION_EMAIL_BLOCKED');
      expect(await AdminUserModel.countDocuments({})).toBe(0);
      expect(await MailboxModel.countDocuments({})).toBe(0);
    });

    it('lets the deleted org\'s recovery email start a brand-new organisation under a new username', async () => {
      // Deliberate: only the username is burned. The person behind it can come back, and the new
      // organisation must be entirely unlinked from the old record.
      const res = await register('newowner', 'Owner@Acme.com');
      expect(res.status).toBe(201);

      const tenant = await TenantModel.findOne({ contactEmail: 'owner@acme.com' });
      expect(tenant).not.toBeNull();

      const before = await OrganisationDeletionModel.findById(deletionId);
      expect(tenant!._id.toString()).not.toBe(before!.tenantId.toString());
      expect(before!.stage).toBe('completed');
      expect(before!.reRegistration.blockedAttempts).toHaveLength(0);
      expect(before!.registrationEmail).toBe('Owner@Acme.com');
    });
  });

  describe('organisation application (register-tenant)', () => {
    const apply = (overrides: Record<string, unknown>) =>
      request(app).post('/api/public/register-tenant').send({
        companyName: 'Acme Corp',
        requestedDomain: 'acme-new.com',
        contactEmail: 'owner@acme.com',
        ...overrides,
      });

    it('blocks by registration email no matter how the organisation name is entered', async () => {
      for (const companyName of ['Acme Corp', 'ACME CORP', 'Acme  Corp.', 'Totally Different Name']) {
        const res = await apply({ companyName, requestedDomain: `try-${Math.random().toString(36).slice(2, 8)}.com` });
        expect(res.status, companyName).toBe(403);
        expect(res.body.error).toBe('REGISTRATION_EMAIL_BLOCKED');
      }
      expect(await RegistrationApplicationModel.countDocuments({})).toBe(0);
    });

    it('accepts a new email under the same organisation name — the block is on the identity, not the name', async () => {
      const res = await apply({ contactEmail: 'brand.new@fresh.com', requestedDomain: 'fresh-acme.com' });
      expect(res.status).toBe(201);
      expect(await RegistrationApplicationModel.countDocuments({ contactEmail: 'brand.new@fresh.com' })).toBe(1);
    });
  });

  describe('the other routes that create accounts', () => {
    const superToken = () => generateOidcToken({ id: new mongoose.Types.ObjectId().toString(), email: 'root@toowix.com', role: 'SUPER_ADMIN', tenantId: null, twoFactorEnabled: false });

    it('refuses a super admin adding a blocked email as an administrator', async () => {
      const tenant = await TenantModel.create({ name: 'Other Org', status: 'active', mailboxLimit: 5, mailboxCount: 0 });
      const res = await request(app)
        .post(`/api/platform/tenants/${tenant._id}/admins`)
        .set('Authorization', `Bearer ${superToken()}`)
        .send({ email: 'Owner+ops@acme.com', password: 'Password123!' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('REGISTRATION_EMAIL_BLOCKED');
      expect(await AdminUserModel.countDocuments({})).toBe(0);
    });

    it('refuses to approve an application whose email was blocked after it was submitted', async () => {
      const application = await RegistrationApplicationModel.create({
        companyName: 'Acme Reborn',
        requestedDomain: 'acme-reborn.com',
        applicantName: 'Olivia Owner',
        contactEmail: 'owner@acme.com',
        status: 'PENDING_REVIEW',
      });
      const res = await request(app).post(`/api/super-admin/applications/${application._id}/approve`).set('Authorization', `Bearer ${superToken()}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('REGISTRATION_EMAIL_BLOCKED');
      expect(await TenantModel.countDocuments({})).toBe(0);
      expect((await RegistrationApplicationModel.findById(application._id))!.status).toBe('PENDING_REVIEW');
    });
  });

  describe('normalizeRegistrationEmail', () => {
    it.each([
      ['Owner@Acme.com', 'owner@acme.com'],
      ['  owner+tag@acme.com ', 'owner@acme.com'],
      ['first.last@gmail.com', 'firstlast@gmail.com'],
      ['first.last+news@googlemail.com', 'firstlast@gmail.com'],
      ['first.last@corp.example', 'first.last@corp.example'], // dots are significant outside gmail
      ['+odd@acme.com', '+odd@acme.com'], // a leading '+' is not a tag
    ])('%s → %s', (input, expected) => {
      expect(normalizeRegistrationEmail(input)).toBe(expected);
    });
  });
});
