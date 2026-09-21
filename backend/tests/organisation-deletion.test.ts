import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import {
  TenantModel,
  DomainModel,
  AdminUserModel,
  MailboxModel,
  OrganisationDeletionModel,
  BlockedRegistrationIdentityModel,
} from '../src/db/models';
import { stalwartClient } from '../src/stalwart/client';
import { emailService } from '../src/services/email.service';
import {
  DELETION_TIMINGS,
  OrganisationDeletionError,
  requestDeletion,
  confirmOrganisationName,
  initiateOtpProcess,
  generateFinalOtp,
  verifyFinalOtp,
  completeDeletion,
  cancelDeletion,
  getActiveDeletion,
  expireStaleDeletions,
  type DeletionActor,
  type RequestContext,
} from '../src/services/organisation-deletion.service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const CONTEXT: RequestContext = {
  ip: '203.0.113.7',
  ipVersion: 4,
  location: 'Mumbai, Maharashtra',
  countryCode: 'IN',
  deviceType: 'desktop',
  os: 'Windows 10/11',
  browser: 'Google Chrome',
  browserVersion: '126.0.0.0',
  sessionId: 'session-abc',
};

let mongoServer: MongoMemoryServer;

describe('organisation deletion state machine', () => {
  let tenantId: string;
  let owner: DeletionActor;
  let t0: Date;
  let sentOtps: string[];

  const at = (ms: number) => new Date(t0.getTime() + ms);
  const input = (now: Date, extra: Record<string, unknown> = {}) => ({ tenantId, actor: owner, context: CONTEXT, now, ...extra });

  const failure = async (promise: Promise<unknown>): Promise<OrganisationDeletionError> => {
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(OrganisationDeletionError);
      return err as OrganisationDeletionError;
    }
    throw new Error('expected the call to fail');
  };

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri(), autoIndex: true });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([
      TenantModel.deleteMany({}),
      DomainModel.deleteMany({}),
      AdminUserModel.deleteMany({}),
      MailboxModel.deleteMany({}),
      OrganisationDeletionModel.deleteMany({}),
      BlockedRegistrationIdentityModel.deleteMany({}),
    ]);

    vi.spyOn(stalwartClient, 'updateDomainStatus').mockResolvedValue();
    vi.spyOn(stalwartClient, 'updateAccountStatus').mockResolvedValue();
    vi.spyOn(stalwartClient, 'listAccounts').mockResolvedValue([]);
    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([]);
    vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();
    vi.spyOn(stalwartClient, 'deleteDomain').mockResolvedValue();

    sentOtps = [];
    vi.spyOn(emailService, 'sendOrganisationDeletionOtpEmail').mockImplementation(async (params) => {
      sentOtps.push(params.otpCode);
      return { success: true };
    });

    t0 = new Date('2026-09-21T10:00:00.000Z');

    const tenant = await TenantModel.create({
      name: 'Acme Corp',
      contactEmail: 'owner@acme.com',
      status: 'active',
      mailboxLimit: 50,
      mailboxCount: 0,
    });
    tenantId = tenant._id.toString();

    const admin = await AdminUserModel.create({
      email: 'owner@acme.com',
      name: 'Olivia Owner',
      passwordHash: 'dummy',
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
      status: 'active',
      twoFactorEnabled: false,
    });
    owner = { id: admin._id.toString(), name: 'Olivia Owner', email: 'owner@acme.com', role: 'TENANT_ADMIN', tenantId };

    await DomainModel.create({ tenantId, domainName: 'acme.com', status: 'active', dnsStatus: 'active', isPrimary: true });
  });

  describe('requesting deletion', () => {
    it('suspends the organisation for 7 days and records who asked, from where', async () => {
      const deletion = await requestDeletion(input(t0, { reason: 'Closing the company' }));

      expect(deletion.stage).toBe('requested');
      expect(deletion.suspensionEndsAt.toISOString()).toBe(at(7 * DAY).toISOString());

      const tenant = await TenantModel.findById(tenantId);
      expect(tenant!.status).toBe('pending_deletion');
      expect((await DomainModel.findOne({ tenantId }))!.status).toBe('suspended');

      const record = await OrganisationDeletionModel.findById(deletion.id);
      expect(record!.organisationName).toBe('Acme Corp');
      expect(record!.registrationEmail).toBe('owner@acme.com');
      expect(record!.domains).toEqual(['acme.com']);
      expect(record!.timeline).toHaveLength(1);
      const entry = record!.timeline[0];
      expect(entry.stage).toBe('requested');
      expect(entry.success).toBe(true);
      expect(entry.actor).toMatchObject({
        userId: owner.id,
        name: 'Olivia Owner',
        email: 'owner@acme.com',
        role: 'TENANT_ADMIN',
        organisationId: tenantId,
        organisationName: 'Acme Corp',
      });
      expect(entry.network).toMatchObject({
        ip: '203.0.113.7',
        ipVersion: 4,
        location: 'Mumbai, Maharashtra',
        deviceType: 'desktop',
        os: 'Windows 10/11',
        browser: 'Google Chrome',
        browserVersion: '126.0.0.0',
        sessionId: 'session-abc',
      });
    });

    it('refuses a second request while one is already in progress', async () => {
      await requestDeletion(input(t0));
      const err = await failure(requestDeletion(input(at(HOUR))));
      expect(err.code).toBe('DELETION_ALREADY_IN_PROGRESS');
    });

    it('does not let a tenant admin act on someone else\'s organisation', async () => {
      const other = await TenantModel.create({ name: 'Other Org', contactEmail: 'x@other.com', status: 'active', mailboxLimit: 5, mailboxCount: 0 });
      const err = await failure(requestDeletion({ tenantId: other._id.toString(), actor: owner, context: CONTEXT, now: t0 }));
      expect(err.code).toBe('FORBIDDEN');
      expect((await TenantModel.findById(other._id))!.status).toBe('active');
    });
  });

  describe('confirming the organisation name', () => {
    it('is locked until the 7-day suspension has passed, and records the failed attempt', async () => {
      const deletion = await requestDeletion(input(t0));

      const err = await failure(confirmOrganisationName(input(at(6 * DAY), { organisationName: 'Acme Corp' })));
      expect(err.code).toBe('STEP_NOT_AVAILABLE_YET');
      expect(err.availableAt?.toISOString()).toBe(at(7 * DAY).toISOString());

      const record = await OrganisationDeletionModel.findById(deletion.id);
      const last = record!.timeline[record!.timeline.length - 1];
      expect(last).toMatchObject({ stage: 'name_confirmed', success: false });
    });

    it('requires the exact organisation name', async () => {
      const deletion = await requestDeletion(input(t0));

      for (const wrong of ['acme corp', 'Acme Corp ', 'Acme', '']) {
        const err = await failure(confirmOrganisationName(input(at(7 * DAY), { organisationName: wrong })));
        expect(err.code).toBe('ORGANISATION_NAME_MISMATCH');
      }

      const record = await OrganisationDeletionModel.findById(deletion.id);
      expect(record!.stage).toBe('requested');
      expect(record!.timeline.filter((e) => e.stage === 'name_confirmed' && !e.success)).toHaveLength(4);
    });

    it('starts the 24-hour security wait once the exact name is entered', async () => {
      await requestDeletion(input(t0));
      const confirmed = await confirmOrganisationName(input(at(7 * DAY), { organisationName: 'Acme Corp' }));

      expect(confirmed.stage).toBe('name_confirmed');
      expect(confirmed.securityWaitEndsAt!.toISOString()).toBe(at(8 * DAY).toISOString());
      expect(confirmed.otpWindowEndsAt!.toISOString()).toBe(at(9 * DAY).toISOString());
    });
  });

  // Walks the happy path up to (and including) `stage`, at the earliest moment each step unlocks.
  const NAME_AT = 7 * DAY;
  const INITIATE_AT = 8 * DAY;
  const GENERATE_AT = 9 * DAY;
  const VERIFY_AT = 9 * DAY + 60 * 1000;
  const COMPLETE_AT = 9 * DAY + 2 * 60 * 1000;

  const advanceTo = async (stage: 'requested' | 'name_confirmed' | 'otp_initiated' | 'final_otp_sent' | 'otp_verified') => {
    await requestDeletion(input(t0));
    if (stage === 'requested') return;
    await confirmOrganisationName(input(at(NAME_AT), { organisationName: 'Acme Corp' }));
    if (stage === 'name_confirmed') return;
    await initiateOtpProcess(input(at(INITIATE_AT)));
    if (stage === 'otp_initiated') return;
    await generateFinalOtp(input(at(GENERATE_AT)));
    if (stage === 'final_otp_sent') return;
    await verifyFinalOtp(input(at(VERIFY_AT), { code: sentOtps[sentOtps.length - 1] }));
  };

  describe('initiating the OTP deletion process', () => {
    it('stays locked through the 24-hour security wait', async () => {
      await advanceTo('name_confirmed');

      const err = await failure(initiateOtpProcess(input(at(NAME_AT + 23 * HOUR))));
      expect(err.code).toBe('STEP_NOT_AVAILABLE_YET');
      expect(err.availableAt?.toISOString()).toBe(at(INITIATE_AT).toISOString());
    });

    it('opens after the wait and starts the second 24-hour lock, capturing context again', async () => {
      await advanceTo('name_confirmed');
      const started = await initiateOtpProcess(input(at(INITIATE_AT + 5 * HOUR)));

      expect(started.stage).toBe('otp_initiated');
      expect(started.finalLockEndsAt!.toISOString()).toBe(at(INITIATE_AT + 5 * HOUR + DAY).toISOString());

      const record = await OrganisationDeletionModel.findOne({ tenantId });
      const entry = record!.timeline[record!.timeline.length - 1];
      expect(entry).toMatchObject({ stage: 'otp_initiated', success: true });
      expect(entry.network).toMatchObject({ ip: '203.0.113.7', browser: 'Google Chrome', sessionId: 'session-abc' });
    });

    it('lapses if nobody starts it inside the 24-hour window, and the organisation is restored', async () => {
      await advanceTo('name_confirmed');

      const err = await failure(initiateOtpProcess(input(at(NAME_AT + 2 * DAY + HOUR))));
      expect(err.code).toBe('OTP_WINDOW_EXPIRED');

      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record!.stage).toBe('expired');
      expect(record!.timeline[record!.timeline.length - 1]).toMatchObject({ stage: 'expired', actor: null });
      expect((await TenantModel.findById(tenantId))!.status).toBe('active');
      expect((await DomainModel.findOne({ tenantId }))!.status).toBe('active');

      // A fresh deletion can be started afterwards.
      await expect(requestDeletion(input(at(NAME_AT + 3 * DAY)))).resolves.toMatchObject({ stage: 'requested' });
    });
  });

  describe('final OTP', () => {
    it('cannot be generated during the second 24-hour lock', async () => {
      await advanceTo('otp_initiated');
      const err = await failure(generateFinalOtp(input(at(INITIATE_AT + 23 * HOUR))));
      expect(err.code).toBe('STEP_NOT_AVAILABLE_YET');
      expect(sentOtps).toHaveLength(0);
    });

    it('is emailed to the acting admin as a 6-digit code once the lock ends', async () => {
      await advanceTo('otp_initiated');
      const view = await generateFinalOtp(input(at(GENERATE_AT)));

      expect(view.stage).toBe('final_otp_sent');
      expect(sentOtps).toHaveLength(1);
      expect(sentOtps[0]).toMatch(/^\d{6}$/);
      expect(emailService.sendOrganisationDeletionOtpEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'owner@acme.com', organisationName: 'Acme Corp' })
      );
    });

    it('is never stored in plain text', async () => {
      await advanceTo('final_otp_sent');
      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(JSON.stringify(record!.toObject())).not.toContain(sentOtps[0]);
    });

    it('reports a delivery failure instead of pretending the code was sent', async () => {
      await advanceTo('otp_initiated');
      vi.spyOn(emailService, 'sendOrganisationDeletionOtpEmail').mockResolvedValue({ success: false, error: 'smtp down' });

      const err = await failure(generateFinalOtp(input(at(GENERATE_AT))));
      expect(err.code).toBe('OTP_DELIVERY_FAILED');
      expect((await OrganisationDeletionModel.findOne({ tenantId }))!.stage).toBe('otp_initiated');
    });

    it('rejects a wrong code, records the failure, and accepts the right one', async () => {
      await advanceTo('final_otp_sent');
      const good = sentOtps[0];
      const bad = good === '000000' ? '111111' : '000000';

      const err = await failure(verifyFinalOtp(input(at(VERIFY_AT), { code: bad })));
      expect(err.code).toBe('INVALID_OTP');
      let record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record!.otpVerification).toBe('failed');
      expect(record!.timeline[record!.timeline.length - 1]).toMatchObject({ stage: 'otp_verified', success: false });

      const ok = await verifyFinalOtp(input(at(VERIFY_AT), { code: good }));
      expect(ok.stage).toBe('otp_verified');
      expect(ok.otpVerification).toBe('verified');
      record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record!.finalOtp.codeHash).toBeNull();
    });

    it('locks after five wrong attempts, even for the correct code, until a new one is generated', async () => {
      await advanceTo('final_otp_sent');
      const good = sentOtps[0];
      const bad = good === '000000' ? '111111' : '000000';

      for (let i = 0; i < 5; i++) {
        await failure(verifyFinalOtp(input(at(VERIFY_AT), { code: bad })));
      }
      const locked = await failure(verifyFinalOtp(input(at(VERIFY_AT), { code: good })));
      expect(locked.code).toBe('OTP_LOCKED');

      await generateFinalOtp(input(at(VERIFY_AT)));
      const fresh = sentOtps[sentOtps.length - 1];
      await expect(verifyFinalOtp(input(at(VERIFY_AT), { code: fresh }))).resolves.toMatchObject({ stage: 'otp_verified' });
    });

    it('cannot be brute-forced by firing guesses in parallel', async () => {
      await advanceTo('final_otp_sent');
      const good = sentOtps[0];
      const bad = good === '000000' ? '111111' : '000000';

      await Promise.allSettled(Array.from({ length: 12 }, () => verifyFinalOtp(input(at(VERIFY_AT), { code: bad }))));

      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record!.finalOtp.attempts).toBe(DELETION_TIMINGS.maxOtpAttempts);
      const locked = await failure(verifyFinalOtp(input(at(VERIFY_AT), { code: good })));
      expect(locked.code).toBe('OTP_LOCKED');
    });

    it('expires ten minutes after it was generated', async () => {
      await advanceTo('final_otp_sent');
      const err = await failure(verifyFinalOtp(input(at(GENERATE_AT + 11 * 60 * 1000), { code: sentOtps[0] })));
      expect(err.code).toBe('OTP_EXPIRED');
    });

    it('can only be verified by the admin it was issued to', async () => {
      await advanceTo('final_otp_sent');
      const otherAdmin: DeletionActor = { id: new Date().getTime().toString(16).padStart(24, '0'), email: 'root@toowix.com', role: 'SUPER_ADMIN' };

      const err = await failure(verifyFinalOtp({ tenantId, actor: otherAdmin, context: CONTEXT, now: at(VERIFY_AT), code: sentOtps[0] }));
      expect(err.code).toBe('OTP_ISSUED_TO_ANOTHER_USER');
    });
  });

  describe('final confirmation and permanent deletion', () => {
    it('is refused until the final OTP has been verified', async () => {
      await advanceTo('final_otp_sent');
      const err = await failure(completeDeletion(input(at(COMPLETE_AT))));
      expect(err.code).toBe('INVALID_STAGE');
      expect(await TenantModel.findById(tenantId)).not.toBeNull();
    });

    it('purges the organisation, keeps the audit record, and blocks the registration email', async () => {
      const mailboxAccountId = 'stalwart-acc-1';
      await MailboxModel.create({
        tenantId,
        domainId: (await DomainModel.findOne({ tenantId }))!._id,
        localPart: 'ceo',
        address: 'ceo@acme.com',
        stalwartAccountId: mailboxAccountId,
        status: 'active',
      });
      await advanceTo('otp_verified');

      const done = await completeDeletion(input(at(COMPLETE_AT)));
      expect(done.stage).toBe('completed');

      expect(await TenantModel.findById(tenantId)).toBeNull();
      expect(await AdminUserModel.countDocuments({ tenantId })).toBe(0);
      expect(await DomainModel.countDocuments({ tenantId })).toBe(0);
      expect(await MailboxModel.countDocuments({ tenantId })).toBe(0);
      expect(stalwartClient.deleteAccount).toHaveBeenCalledWith(mailboxAccountId);

      // The permanent record survives, and answers who / when / where / which steps.
      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record).toMatchObject({
        stage: 'completed',
        organisationName: 'Acme Corp',
        registrationEmail: 'owner@acme.com',
        domains: ['acme.com'],
        otpVerification: 'verified',
      });
      expect(record!.completedAt!.toISOString()).toBe(at(COMPLETE_AT).toISOString());
      expect(record!.completedBy).toMatchObject({ email: 'owner@acme.com', role: 'TENANT_ADMIN', organisationName: 'Acme Corp' });
      expect(record!.completedNetwork).toMatchObject({ ip: '203.0.113.7', location: 'Mumbai, Maharashtra' });
      expect(record!.initiatedBy).toMatchObject({ email: 'owner@acme.com', role: 'TENANT_ADMIN' });
      expect(record!.timeline.filter((e) => e.success).map((e) => e.stage)).toEqual([
        'requested',
        'name_confirmed',
        'otp_initiated',
        'otp_generation',
        'otp_verified',
        'final_confirmation',
      ]);

      const blocked = await BlockedRegistrationIdentityModel.findOne({ emailNormalized: 'owner@acme.com' });
      expect(blocked).not.toBeNull();
      expect(blocked!.deletionId.toString()).toBe(record!._id.toString());
      expect(record!.emailRestriction).toMatchObject({ email: 'owner@acme.com', permanent: true });
      expect(record!.reRegistration.status).toBe('blocked');
    });

    it('records the super admin, not the tenant, when a super admin drives the flow', async () => {
      const superAdmin: DeletionActor = { id: '64b7f0f0f0f0f0f0f0f0f0f0', name: 'Priya Root', email: 'root@toowix.com', role: 'SUPER_ADMIN' };
      const run = (now: Date, extra: Record<string, unknown> = {}) => ({ tenantId, actor: superAdmin, context: CONTEXT, now, ...extra });

      await requestDeletion(run(t0));
      await confirmOrganisationName(run(at(NAME_AT), { organisationName: 'Acme Corp' }));
      await initiateOtpProcess(run(at(INITIATE_AT)));
      await generateFinalOtp(run(at(GENERATE_AT)));
      expect(emailService.sendOrganisationDeletionOtpEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'root@toowix.com' }));
      await verifyFinalOtp(run(at(VERIFY_AT), { code: sentOtps[0] }));
      await completeDeletion(run(at(COMPLETE_AT)));

      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record!.initiatedBy).toMatchObject({ role: 'SUPER_ADMIN', email: 'root@toowix.com', name: 'Priya Root', organisationId: tenantId });
      expect(record!.completedBy).toMatchObject({ role: 'SUPER_ADMIN', email: 'root@toowix.com' });
    });
  });

  describe('cancelling', () => {
    it('restores the organisation and leaves the registration email unblocked', async () => {
      await advanceTo('name_confirmed');
      const cancelled = await cancelDeletion(input(at(NAME_AT + HOUR)));

      expect(cancelled.stage).toBe('cancelled');
      expect((await TenantModel.findById(tenantId))!.status).toBe('active');
      expect((await DomainModel.findOne({ tenantId }))!.status).toBe('active');
      expect(await BlockedRegistrationIdentityModel.countDocuments({})).toBe(0);
      expect(await getActiveDeletion(input(at(NAME_AT + 2 * HOUR)))).toBeNull();

      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record!.timeline[record!.timeline.length - 1]).toMatchObject({ stage: 'cancelled', success: true });
    });

    it('cannot cancel a deletion that has already completed', async () => {
      await advanceTo('otp_verified');
      await completeDeletion(input(at(COMPLETE_AT)));
      const err = await failure(cancelDeletion(input(at(COMPLETE_AT + HOUR))));
      expect(err.code).toBe('NO_ACTIVE_DELETION');
    });

    it('returns to the previous status when the org was already suspended before deletion was requested', async () => {
      await TenantModel.updateOne({ _id: tenantId }, { status: 'suspended' });
      await requestDeletion(input(t0));
      await cancelDeletion(input(at(HOUR)));
      expect((await TenantModel.findById(tenantId))!.status).toBe('suspended');
    });
  });

  it('the background sweep lapses a missed OTP window even when nobody calls in', async () => {
    await advanceTo('name_confirmed');
    expect(await expireStaleDeletions(at(NAME_AT + DAY + HOUR))).toBe(0); // window still open
    expect(await expireStaleDeletions(at(NAME_AT + 2 * DAY + HOUR))).toBe(1);

    expect((await OrganisationDeletionModel.findOne({ tenantId }))!.stage).toBe('expired');
    expect((await TenantModel.findById(tenantId))!.status).toBe('active');
  });

  it('exposes the timings as the single source of truth', () => {
    expect(DELETION_TIMINGS).toMatchObject({ suspensionMs: 7 * DAY, securityWaitMs: DAY, otpWindowMs: DAY, finalLockMs: DAY });
  });
});

