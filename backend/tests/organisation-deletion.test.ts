import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import {
  TenantModel,
  DomainModel,
  AdminUserModel,
  MailboxModel,
  OrganisationDeletionModel,
  BlockedRegistrationIdentityModel,
  DomainSubscriptionModel,
} from '../src/db/models';
import { stalwartClient } from '../src/stalwart/client';
import { emailService } from '../src/services/email.service';
import { deleteDomainDirectly } from '../src/services/domain-deletion.service';
import {
  DELETION_TIMINGS,
  OrganisationDeletionError,
  requestDeletion,
  confirmOrganisationName,
  initiateOtpProcess,
  generateFinalOtp,
  verifyFinalOtp,
  cancelDeletion,
  getActiveDeletion,
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

  // Each step at the earliest moment it unlocks: name right after the reason, OTP request after
  // the 7-day suspension, the code 24h after that.
  const NAME_AT = HOUR;
  const INITIATE_AT = NAME_AT + 7 * DAY;
  const GENERATE_AT = INITIATE_AT + DAY;
  const VERIFY_AT = GENERATE_AT + 60 * 1000;

  const advanceTo = async (stage: 'requested' | 'name_confirmed' | 'otp_initiated' | 'final_otp_sent') => {
    await requestDeletion(input(t0, { reason: 'Closing the company' }));
    if (stage === 'requested') return;
    await confirmOrganisationName(input(at(NAME_AT), { organisationName: 'Acme Corp' }));
    if (stage === 'name_confirmed') return;
    await initiateOtpProcess(input(at(INITIATE_AT)));
    if (stage === 'otp_initiated') return;
    await generateFinalOtp(input(at(GENERATE_AT)));
  };

  const addDomain = () => DomainModel.create({ tenantId, domainName: 'acme.com', status: 'active', dnsStatus: 'active', isPrimary: true });

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

    const tenant = await TenantModel.create({ name: 'Acme Corp', contactEmail: 'owner@acme.com', status: 'active', mailboxLimit: 50, mailboxCount: 0 });
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

  });

  describe('step 1 — asking to delete, with a reason', () => {
    it('records who asked and why, from where — without suspending anything yet', async () => {
      const deletion = await requestDeletion(input(t0, { reason: 'Closing the company' }));

      expect(deletion.stage).toBe('requested');
      expect(deletion.nextAction).toBe('confirm_name');
      expect(deletion.suspensionEndsAt).toBeNull();
      expect((await TenantModel.findById(tenantId))!.status).toBe('active');

      const record = await OrganisationDeletionModel.findById(deletion.id);
      expect(record).toMatchObject({
        organisationName: 'Acme Corp',
        registrationEmail: 'owner@acme.com',
        domains: [],
        reason: 'Closing the company',
      });
      expect(record!.timeline).toHaveLength(1);
      const entry = record!.timeline[0];
      expect(entry).toMatchObject({ stage: 'requested', success: true });
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

    it('refuses to start while the organisation still has domains', async () => {
      await addDomain();
      const err = await failure(requestDeletion(input(t0)));
      expect(err.code).toBe('DOMAINS_EXIST');
      expect(err.message).toMatch(/1 domain/);
      expect(await OrganisationDeletionModel.countDocuments({ tenantId })).toBe(0);
      expect((await TenantModel.findById(tenantId))!.status).toBe('active');
    });

    it('keeps a record of the domains the organisation deleted beforehand', async () => {
      const domain = await addDomain();
      await deleteDomainDirectly(domain._id.toString(), tenantId, { id: owner.id, email: owner.email, role: 'TENANT_ADMIN' });

      const deletion = await requestDeletion(input(t0));
      const record = await OrganisationDeletionModel.findById(deletion.id);
      expect(record!.domains).toEqual(['acme.com']);
    });

    it('refuses a second request while one is already in progress', async () => {
      await requestDeletion(input(t0));
      const err = await failure(requestDeletion(input(at(HOUR))));
      expect(err.code).toBe('DELETION_ALREADY_IN_PROGRESS');
    });

    it("does not let a tenant admin act on someone else's organisation", async () => {
      const other = await TenantModel.create({ name: 'Other Org', contactEmail: 'x@other.com', status: 'active', mailboxLimit: 5, mailboxCount: 0 });
      const err = await failure(requestDeletion({ tenantId: other._id.toString(), actor: owner, context: CONTEXT, now: t0 }));
      expect(err.code).toBe('FORBIDDEN');
      expect((await TenantModel.findById(other._id))!.status).toBe('active');
    });
  });

  describe('step 2 — entering the organisation name suspends the organisation', () => {
    it('requires the exact name and records each wrong attempt', async () => {
      const deletion = await requestDeletion(input(t0));

      for (const wrong of ['acme corp', 'Acme Corp ', 'Acme', '']) {
        const err = await failure(confirmOrganisationName(input(at(NAME_AT), { organisationName: wrong })));
        expect(err.code).toBe('ORGANISATION_NAME_MISMATCH');
      }

      const record = await OrganisationDeletionModel.findById(deletion.id);
      expect(record!.stage).toBe('requested');
      expect(record!.timeline.filter((e) => e.stage === 'name_confirmed' && !e.success)).toHaveLength(4);
      expect((await TenantModel.findById(tenantId))!.status).toBe('active');
    });

    it('suspends the organisation and starts the 7-day wait as soon as the exact name is entered', async () => {
      await requestDeletion(input(t0));
      const confirmed = await confirmOrganisationName(input(at(NAME_AT), { organisationName: 'Acme Corp' }));

      expect(confirmed.stage).toBe('name_confirmed');
      expect(confirmed.nextAction).toBe('initiate_otp');
      expect(confirmed.suspensionEndsAt!.toISOString()).toBe(at(NAME_AT + 7 * DAY).toISOString());
      expect((await TenantModel.findById(tenantId))!.status).toBe('pending_deletion');
    });

    it('will not suspend if a domain was added after the deletion was requested', async () => {
      const deletion = await requestDeletion(input(t0));
      await addDomain();

      const err = await failure(confirmOrganisationName(input(at(NAME_AT), { organisationName: 'Acme Corp' })));
      expect(err.code).toBe('DOMAINS_EXIST');
      expect((await TenantModel.findById(tenantId))!.status).toBe('active');

      const record = await OrganisationDeletionModel.findById(deletion.id);
      expect(record!.stage).toBe('requested');
      expect(record!.timeline[record!.timeline.length - 1]).toMatchObject({ stage: 'name_confirmed', success: false });
    });

    it('is not available before a deletion has been requested', async () => {
      const err = await failure(confirmOrganisationName(input(at(NAME_AT), { organisationName: 'Acme Corp' })));
      expect(err.code).toBe('NO_ACTIVE_DELETION');
    });
  });

  describe('step 3 — requesting the OTP after the 7-day wait', () => {
    it('stays locked for the whole 7 days, and records the attempt', async () => {
      await advanceTo('name_confirmed');

      const err = await failure(initiateOtpProcess(input(at(NAME_AT + 7 * DAY - HOUR))));
      expect(err.code).toBe('STEP_NOT_AVAILABLE_YET');
      expect(err.availableAt?.toISOString()).toBe(at(INITIATE_AT).toISOString());

      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record!.timeline[record!.timeline.length - 1]).toMatchObject({ stage: 'otp_initiated', success: false });
    });

    it('opens after 7 days, starts the 24-hour wait, and captures the context again', async () => {
      await advanceTo('name_confirmed');
      const started = await initiateOtpProcess(input(at(INITIATE_AT + 5 * HOUR)));

      expect(started.stage).toBe('otp_initiated');
      expect(started.nextAction).toBe('generate_final_otp');
      expect(started.nextActionAvailableAt!.toISOString()).toBe(at(INITIATE_AT + 5 * HOUR + DAY).toISOString());

      const record = await OrganisationDeletionModel.findOne({ tenantId });
      const entry = record!.timeline[record!.timeline.length - 1];
      expect(entry).toMatchObject({ stage: 'otp_initiated', success: true });
      expect(entry.network).toMatchObject({ ip: '203.0.113.7', browser: 'Google Chrome', sessionId: 'session-abc' });
    });

    it('has no deadline — the deletion waits for as long as the admin does', async () => {
      await advanceTo('name_confirmed');
      await expect(initiateOtpProcess(input(at(NAME_AT + 60 * DAY)))).resolves.toMatchObject({ stage: 'otp_initiated' });
    });

    it('cannot be requested before the name was confirmed', async () => {
      await advanceTo('requested');
      const err = await failure(initiateOtpProcess(input(at(INITIATE_AT))));
      expect(err.code).toBe('INVALID_STAGE');
    });
  });

  describe('step 4 — sending the code and entering it', () => {
    it('cannot be sent during the 24-hour wait', async () => {
      await advanceTo('otp_initiated');
      const err = await failure(generateFinalOtp(input(at(INITIATE_AT + 23 * HOUR))));
      expect(err.code).toBe('STEP_NOT_AVAILABLE_YET');
      expect(sentOtps).toHaveLength(0);
    });

    it('is emailed to the acting admin as a 6-digit code once the wait ends', async () => {
      await advanceTo('otp_initiated');
      const view = await generateFinalOtp(input(at(GENERATE_AT)));

      expect(view.stage).toBe('final_otp_sent');
      expect(view.nextAction).toBe('verify_final_otp');
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

    it('rejects a wrong code and records the failure', async () => {
      await advanceTo('final_otp_sent');
      const bad = sentOtps[0] === '000000' ? '111111' : '000000';

      const err = await failure(verifyFinalOtp(input(at(VERIFY_AT), { code: bad })));
      expect(err.code).toBe('INVALID_OTP');

      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record!.stage).toBe('final_otp_sent');
      expect(record!.otpVerification).toBe('failed');
      expect(record!.timeline[record!.timeline.length - 1]).toMatchObject({ stage: 'otp_verified', success: false });
      expect(await TenantModel.findById(tenantId)).not.toBeNull();
    });

    it('locks after five wrong attempts, even for the correct code, until a new one is sent', async () => {
      await advanceTo('final_otp_sent');
      const good = sentOtps[0];
      const bad = good === '000000' ? '111111' : '000000';

      for (let i = 0; i < 5; i++) await failure(verifyFinalOtp(input(at(VERIFY_AT), { code: bad })));
      const locked = await failure(verifyFinalOtp(input(at(VERIFY_AT), { code: good })));
      expect(locked.code).toBe('OTP_LOCKED');

      await generateFinalOtp(input(at(VERIFY_AT)));
      await expect(verifyFinalOtp(input(at(VERIFY_AT), { code: sentOtps[sentOtps.length - 1] }))).resolves.toMatchObject({ stage: 'completed' });
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

    it('expires ten minutes after it was sent', async () => {
      await advanceTo('final_otp_sent');
      const err = await failure(verifyFinalOtp(input(at(GENERATE_AT + 11 * 60 * 1000), { code: sentOtps[0] })));
      expect(err.code).toBe('OTP_EXPIRED');
    });

    it('can only be entered by the admin it was sent to', async () => {
      await advanceTo('final_otp_sent');
      const otherAdmin: DeletionActor = { id: '64b7f0f0f0f0f0f0f0f0f0f1', email: 'root@toowix.com', role: 'SUPER_ADMIN' };

      const err = await failure(verifyFinalOtp({ tenantId, actor: otherAdmin, context: CONTEXT, now: at(VERIFY_AT), code: sentOtps[0] }));
      expect(err.code).toBe('OTP_ISSUED_TO_ANOTHER_USER');
      expect(await TenantModel.findById(tenantId)).not.toBeNull();
    });
  });

  describe('entering the correct code deletes the organisation', () => {
    it('purges everything, keeps the audit record, and blocks the registration email', async () => {
      await advanceTo('final_otp_sent');

      const done = await verifyFinalOtp(input(at(VERIFY_AT), { code: sentOtps[0] }));
      expect(done.stage).toBe('completed');
      expect(done.nextAction).toBeNull();

      expect(await TenantModel.findById(tenantId)).toBeNull();
      expect(await AdminUserModel.countDocuments({ tenantId })).toBe(0);

      // The permanent record survives, and answers who / when / where / which steps.
      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record).toMatchObject({
        stage: 'completed',
        organisationName: 'Acme Corp',
        registrationEmail: 'owner@acme.com',
        domains: [],
        otpVerification: 'verified',
      });
      expect(record!.completedAt!.toISOString()).toBe(at(VERIFY_AT).toISOString());
      expect(record!.completedBy).toMatchObject({ email: 'owner@acme.com', role: 'TENANT_ADMIN', organisationName: 'Acme Corp' });
      expect(record!.completedNetwork).toMatchObject({ ip: '203.0.113.7', location: 'Mumbai, Maharashtra' });
      expect(record!.initiatedBy).toMatchObject({ email: 'owner@acme.com', role: 'TENANT_ADMIN' });
      expect(record!.finalOtp.codeHash).toBeNull();
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

    it('burns the admin\'s username, not the external recovery email, and purges the platform mailbox', async () => {
      // A tenant registered the new way: login identity on the platform domain, contactEmail is the
      // external recovery address, and the identity mailbox hangs off the platform tenant.
      const platformTenant = await TenantModel.create({ name: 'Toowix Platform Identities', status: 'active', mailboxLimit: 1000, mailboxCount: 0 });
      const platformDomain = await DomainModel.create({ tenantId: platformTenant._id, domainName: 'dhkmail.com', status: 'active', dnsStatus: 'active', isPrimary: true, mailboxLimit: 1000 });

      await TenantModel.updateOne({ _id: tenantId }, { contactEmail: 'olivia.personal@gmail.com' });
      await AdminUserModel.updateOne({ tenantId }, { email: 'olivia@dhkmail.com' });
      await MailboxModel.create({
        tenantId: platformTenant._id,
        domainId: platformDomain._id,
        localPart: 'olivia',
        address: 'olivia@dhkmail.com',
        stalwartAccountId: 'stalwart-platform-1',
        status: 'active',
      });

      const actor: DeletionActor = { id: owner.id, name: 'Olivia Owner', email: 'olivia@dhkmail.com', role: 'TENANT_ADMIN', tenantId };
      const run = (now: Date, extra: Record<string, unknown> = {}) => ({ tenantId, actor, context: CONTEXT, now, ...extra });

      await requestDeletion(run(t0));
      await confirmOrganisationName(run(at(NAME_AT), { organisationName: 'Acme Corp' }));
      await initiateOtpProcess(run(at(INITIATE_AT)));
      await generateFinalOtp(run(at(GENERATE_AT)));
      await verifyFinalOtp(run(at(VERIFY_AT), { code: sentOtps[0] }));

      // The username is burned...
      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record!.registrationEmail).toBe('olivia@dhkmail.com');
      expect(await BlockedRegistrationIdentityModel.findOne({ emailNormalized: 'olivia@dhkmail.com' })).not.toBeNull();

      // ...but the external recovery address stays usable for a future organisation.
      expect(await BlockedRegistrationIdentityModel.findOne({ emailNormalized: 'olivia.personal@gmail.com' })).toBeNull();

      // The identity mailbox lives under the platform tenant, so a plain {tenantId} sweep would miss it.
      expect(await MailboxModel.findOne({ address: 'olivia@dhkmail.com' })).toBeNull();
      expect(stalwartClient.deleteAccount).toHaveBeenCalledWith('stalwart-platform-1');
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

      const record = await OrganisationDeletionModel.findOne({ tenantId });
      expect(record!.initiatedBy).toMatchObject({ role: 'SUPER_ADMIN', email: 'root@toowix.com', name: 'Priya Root', organisationId: tenantId });
      expect(record!.completedBy).toMatchObject({ role: 'SUPER_ADMIN', email: 'root@toowix.com' });
    });
  });

  describe('restoring the organisation before the code is entered', () => {
    it.each(['requested', 'name_confirmed', 'otp_initiated', 'final_otp_sent'] as const)(
      'is possible at the "%s" step, and leaves the registration email unblocked',
      async (stage) => {
        await advanceTo(stage);
        const cancelled = await cancelDeletion(input(at(GENERATE_AT + HOUR)));

        expect(cancelled.stage).toBe('cancelled');
        expect((await TenantModel.findById(tenantId))!.status).toBe('active');
        expect(await BlockedRegistrationIdentityModel.countDocuments({})).toBe(0);
        expect(await getActiveDeletion(input(at(GENERATE_AT + 2 * HOUR)))).toBeNull();

        const record = await OrganisationDeletionModel.findOne({ tenantId });
        expect(record!.timeline[record!.timeline.length - 1]).toMatchObject({ stage: 'cancelled', success: true });
        expect(record!.finalOtp.codeHash).toBeNull();
      }
    );

    it('makes an already-emailed code useless, and lets a fresh deletion start later', async () => {
      await advanceTo('final_otp_sent');
      const code = sentOtps[0];
      await cancelDeletion(input(at(VERIFY_AT)));

      const err = await failure(verifyFinalOtp(input(at(VERIFY_AT), { code })));
      expect(err.code).toBe('NO_ACTIVE_DELETION');
      expect(await TenantModel.findById(tenantId)).not.toBeNull();

      await expect(requestDeletion(input(at(VERIFY_AT + HOUR)))).resolves.toMatchObject({ stage: 'requested' });
    });

    it('is no longer possible once the deletion has completed', async () => {
      await advanceTo('final_otp_sent');
      await verifyFinalOtp(input(at(VERIFY_AT), { code: sentOtps[0] }));
      const err = await failure(cancelDeletion(input(at(VERIFY_AT + HOUR))));
      expect(err.code).toBe('NO_ACTIVE_DELETION');
    });

    it('returns to the previous status when the org was already suspended before deletion was requested', async () => {
      await TenantModel.updateOne({ _id: tenantId }, { status: 'suspended' });
      await requestDeletion(input(t0));
      await confirmOrganisationName(input(at(NAME_AT), { organisationName: 'Acme Corp' }));
      await cancelDeletion(input(at(HOUR * 2)));
      expect((await TenantModel.findById(tenantId))!.status).toBe('suspended');
    });
  });

  it('exposes the timings as the single source of truth', () => {
    expect(DELETION_TIMINGS).toMatchObject({ suspensionMs: 7 * DAY, finalLockMs: DAY, finalOtpTtlMs: 10 * 60 * 1000 });
  });
});
