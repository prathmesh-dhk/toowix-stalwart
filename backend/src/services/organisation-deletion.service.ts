import crypto from 'crypto';
import { Types } from 'mongoose';
import { TenantModel, ITenant } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { AdminUserModel } from '../db/models/AdminUser';
import {
  OrganisationDeletionModel,
  IOrganisationDeletion,
  ACTIVE_DELETION_STAGES,
  DeletionStage,
  TimelineStage,
  IDeletionActor,
  IDeletionNetwork,
} from '../db/models/OrganisationDeletion';
import { BlockedRegistrationIdentityModel } from '../db/models/BlockedRegistrationIdentity';
import { normalizeRegistrationEmail } from '../utils/email-identity';
import { emailService } from './email.service';
import { logAudit } from '../audit/service';
import { suspendTenantInfrastructure, restoreTenantInfrastructure, purgeTenant } from './tenant-lifecycle.service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The spec's security timeline. Exported so tests (and the UI, via the API) never hard-code them. */
export const DELETION_TIMINGS = {
  /** Organisation stays suspended (and can still be restored) before the name can be entered. */
  suspensionMs: 7 * DAY_MS,
  /** Wait after the exact organisation name is entered. */
  securityWaitMs: 24 * HOUR_MS,
  /** Window in which the OTP deletion process may be initiated once the wait ends. */
  otpWindowMs: 24 * HOUR_MS,
  /** Second lock between initiating the OTP process and being able to generate the final OTP. */
  finalLockMs: 24 * HOUR_MS,
  /** Lifetime of one emailed final OTP. */
  finalOtpTtlMs: 10 * 60 * 1000,
  maxOtpAttempts: 5,
} as const;

export interface DeletionActor {
  id: string;
  name?: string | null;
  email: string;
  role: 'SUPER_ADMIN' | 'TENANT_ADMIN';
  tenantId?: string | null;
}

export interface RequestContext {
  ip: string;
  ipVersion: 4 | 6 | null;
  location: string;
  countryCode?: string | null;
  deviceType: string;
  os: string;
  browser: string;
  browserVersion: string;
  sessionId?: string | null;
}

export interface StageInput {
  tenantId: string;
  actor: DeletionActor;
  context: RequestContext;
  /** Injectable clock — routes never pass it; tests use it to cross the 7d/24h gates. */
  now?: Date;
}

export class OrganisationDeletionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
    public readonly availableAt?: Date
  ) {
    super(message);
    this.name = 'OrganisationDeletionError';
  }
}

export type NextAction =
  | 'confirm_name'
  | 'initiate_otp'
  | 'generate_final_otp'
  | 'verify_final_otp'
  | 'final_confirmation'
  | null;

export interface DeletionView {
  id: string;
  tenantId: string;
  organisationName: string;
  stage: DeletionStage;
  path: 'standard' | 'forced';
  initiatedAt: Date;
  suspensionEndsAt: Date;
  nameConfirmedAt: Date | null;
  securityWaitEndsAt: Date | null;
  otpWindowEndsAt: Date | null;
  otpInitiatedAt: Date | null;
  finalLockEndsAt: Date | null;
  otpVerifiedAt: Date | null;
  otpVerification: IOrganisationDeletion['otpVerification'];
  finalOtpExpiresAt: Date | null;
  completedAt: Date | null;
  /** What the operator can do next, and from when (null availableAt = right now). */
  nextAction: NextAction;
  nextActionAvailableAt: Date | null;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function assertAuthorised(actor: DeletionActor, tenantId: string): void {
  if (actor.role === 'SUPER_ADMIN') return;
  if (actor.role === 'TENANT_ADMIN' && actor.tenantId && actor.tenantId === tenantId) return;
  throw new OrganisationDeletionError('You are not allowed to manage this organisation.', 'FORBIDDEN', 403);
}

const networkSnapshot = (context: RequestContext): IDeletionNetwork => ({
  ...context,
  countryCode: context.countryCode ?? null,
  sessionId: context.sessionId ?? null,
});

function actorSnapshot(actor: DeletionActor, deletion: { tenantId: Types.ObjectId; organisationName: string }): IDeletionActor {
  return {
    userId: actor.id,
    name: actor.name ?? null,
    email: actor.email,
    role: actor.role,
    organisationId: deletion.tenantId.toString(),
    organisationName: deletion.organisationName,
  };
}

async function record(
  deletion: IOrganisationDeletion,
  entry: { stage: TimelineStage; action: string; success: boolean; message?: string },
  actor: DeletionActor | null,
  context: RequestContext | null,
  now: Date
): Promise<void> {
  deletion.timeline.push({
    stage: entry.stage,
    action: entry.action,
    success: entry.success,
    at: now,
    message: entry.message ?? null,
    actor: actor ? actorSnapshot(actor, deletion) : null,
    network: context ? networkSnapshot(context) : null,
  });

  // Mirror into the platform audit log so it shows up alongside every other privileged action.
  await logAudit({
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? 'SYSTEM',
    actorEmail: actor?.email ?? null,
    actorIp: context?.ip ?? null,
    tenantId: deletion.tenantId.toString(),
    action: `ORG_DELETION_${entry.action.toUpperCase()}`,
    resource: 'ORGANISATION',
    resourceId: deletion.tenantId.toString(),
    success: entry.success,
    metadata: {
      deletionId: deletion._id.toString(),
      stage: entry.stage,
      organisationName: deletion.organisationName,
      message: entry.message ?? null,
      location: context?.location ?? null,
      device: context ? `${context.deviceType} / ${context.os} / ${context.browser} ${context.browserVersion}`.trim() : null,
      sessionId: context?.sessionId ?? null,
    },
  });
}

/** Persists a failed attempt on the timeline, then throws — failures are part of the audit trail. */
async function failStep(
  deletion: IOrganisationDeletion,
  stage: TimelineStage,
  action: string,
  actor: DeletionActor,
  context: RequestContext,
  now: Date,
  error: OrganisationDeletionError
): Promise<never> {
  await record(deletion, { stage, action, success: false, message: error.message }, actor, context, now);
  await deletion.save();
  throw error;
}

async function loadActive(tenantId: string): Promise<IOrganisationDeletion> {
  const deletion = await OrganisationDeletionModel.findOne({ tenantId, stage: { $in: ACTIVE_DELETION_STAGES } });
  if (!deletion) {
    throw new OrganisationDeletionError('No deletion is in progress for this organisation.', 'NO_ACTIVE_DELETION', 404);
  }
  return deletion;
}

function nextActionFor(deletion: IOrganisationDeletion): { action: NextAction; availableAt: Date | null } {
  switch (deletion.stage) {
    case 'requested':
      return { action: 'confirm_name', availableAt: deletion.suspensionEndsAt };
    case 'name_confirmed':
      return { action: 'initiate_otp', availableAt: deletion.securityWaitEndsAt };
    case 'otp_initiated':
      return { action: 'generate_final_otp', availableAt: deletion.finalLockEndsAt };
    case 'final_otp_sent':
      return { action: 'verify_final_otp', availableAt: null };
    case 'otp_verified':
      return { action: 'final_confirmation', availableAt: null };
    default:
      return { action: null, availableAt: null };
  }
}

export function toDeletionView(deletion: IOrganisationDeletion): DeletionView {
  const next = nextActionFor(deletion);
  return {
    id: deletion._id.toString(),
    tenantId: deletion.tenantId.toString(),
    organisationName: deletion.organisationName,
    stage: deletion.stage,
    path: deletion.path,
    initiatedAt: deletion.initiatedAt,
    suspensionEndsAt: deletion.suspensionEndsAt,
    nameConfirmedAt: deletion.nameConfirmedAt,
    securityWaitEndsAt: deletion.securityWaitEndsAt,
    otpWindowEndsAt: deletion.otpWindowEndsAt,
    otpInitiatedAt: deletion.otpInitiatedAt,
    finalLockEndsAt: deletion.finalLockEndsAt,
    otpVerifiedAt: deletion.otpVerifiedAt,
    otpVerification: deletion.otpVerification,
    finalOtpExpiresAt: deletion.finalOtp?.expiresAt ?? null,
    completedAt: deletion.completedAt,
    nextAction: next.action,
    nextActionAvailableAt: next.availableAt,
  };
}

function requireAvailable(availableAt: Date | null, now: Date): OrganisationDeletionError | null {
  if (availableAt && now < availableAt) {
    return new OrganisationDeletionError(
      `This step unlocks at ${availableAt.toISOString()}.`,
      'STEP_NOT_AVAILABLE_YET',
      409,
      availableAt
    );
  }
  return null;
}

function wrongStage(deletion: IOrganisationDeletion, expected: string): OrganisationDeletionError {
  return new OrganisationDeletionError(
    `This step is not available while the deletion is at stage '${deletion.stage}' (expected ${expected}).`,
    'INVALID_STAGE',
    409
  );
}

// ---------------------------------------------------------------------------
// stage 1 — request
// ---------------------------------------------------------------------------

/** Copies everything the permanent record must keep (it has to outlive the Tenant) and inserts it. */
async function createDeletionRecord(
  tenant: ITenant,
  input: StageInput & { reason?: string | null },
  now: Date,
  path: 'standard' | 'forced'
): Promise<IOrganisationDeletion> {
  const { actor, context } = input;

  // The identity that will be blocked: the registration email, falling back to the earliest admin.
  let registrationEmail: string | null = tenant.contactEmail || null;
  if (!registrationEmail) {
    const firstAdmin = await AdminUserModel.findOne({ tenantId: tenant._id, role: 'TENANT_ADMIN' }).sort({ createdAt: 1 });
    registrationEmail = firstAdmin?.email ?? null;
  }
  const domains = (await DomainModel.find({ tenantId: tenant._id }).sort({ createdAt: 1 })).map((d) => d.domainName);

  try {
    return await OrganisationDeletionModel.create({
      tenantId: tenant._id,
      organisationName: tenant.name,
      registrationEmail,
      registrationEmailNormalized: registrationEmail ? normalizeRegistrationEmail(registrationEmail) : null,
      domains,
      organisationCreatedAt: tenant.createdAt,
      previousTenantStatus: tenant.status,
      path,
      reason: input.reason?.trim() || null,
      stage: 'requested',
      initiatedAt: now,
      initiatedBy: actorSnapshot(actor, { tenantId: tenant._id, organisationName: tenant.name }),
      initiatedNetwork: networkSnapshot(context),
      suspensionEndsAt: new Date(now.getTime() + DELETION_TIMINGS.suspensionMs),
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      throw new OrganisationDeletionError('A deletion is already in progress for this organisation.', 'DELETION_ALREADY_IN_PROGRESS', 409);
    }
    throw err;
  }
}

export async function requestDeletion(input: StageInput & { reason?: string | null }): Promise<DeletionView> {
  const { tenantId, actor, context } = input;
  const now = input.now ?? new Date();
  assertAuthorised(actor, tenantId);

  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new OrganisationDeletionError('Organisation not found.', 'TENANT_NOT_FOUND', 404);

  if (tenant.status === 'pending_deletion' || (await OrganisationDeletionModel.exists({ tenantId, stage: { $in: ACTIVE_DELETION_STAGES } }))) {
    throw new OrganisationDeletionError('A deletion is already in progress for this organisation.', 'DELETION_ALREADY_IN_PROGRESS', 409);
  }

  const deletion = await createDeletionRecord(tenant, input, now, 'standard');

  await record(deletion, { stage: 'requested', action: 'requested', success: true, message: input.reason?.trim() || undefined }, actor, context, now);
  await deletion.save();

  tenant.status = 'pending_deletion';
  await tenant.save();
  await suspendTenantInfrastructure(tenant._id);

  return toDeletionView(deletion);
}

// ---------------------------------------------------------------------------
// stage 2 — exact organisation name
// ---------------------------------------------------------------------------

export async function confirmOrganisationName(input: StageInput & { organisationName: string }): Promise<DeletionView> {
  const { tenantId, actor, context } = input;
  const now = input.now ?? new Date();
  assertAuthorised(actor, tenantId);

  const deletion = await loadActive(tenantId);
  if (deletion.stage !== 'requested') throw wrongStage(deletion, 'requested');

  const early = requireAvailable(deletion.suspensionEndsAt, now);
  if (early) return failStep(deletion, 'name_confirmed', 'name_confirmation_failed', actor, context, now, early);

  if (input.organisationName !== deletion.organisationName) {
    return failStep(
      deletion,
      'name_confirmed',
      'name_confirmation_failed',
      actor,
      context,
      now,
      new OrganisationDeletionError('The organisation name does not match exactly.', 'ORGANISATION_NAME_MISMATCH', 400)
    );
  }

  deletion.stage = 'name_confirmed';
  deletion.nameConfirmedAt = now;
  deletion.securityWaitEndsAt = new Date(now.getTime() + DELETION_TIMINGS.securityWaitMs);
  deletion.otpWindowEndsAt = new Date(deletion.securityWaitEndsAt.getTime() + DELETION_TIMINGS.otpWindowMs);
  await record(deletion, { stage: 'name_confirmed', action: 'name_confirmed', success: true }, actor, context, now);
  await deletion.save();

  return toDeletionView(deletion);
}

// ---------------------------------------------------------------------------
// abort paths — the organisation goes back to how it was
// ---------------------------------------------------------------------------

async function restoreTenantAfterAbort(deletion: IOrganisationDeletion): Promise<void> {
  const tenant = await TenantModel.findById(deletion.tenantId);
  if (!tenant || tenant.status !== 'pending_deletion') return;

  tenant.status = deletion.previousTenantStatus as typeof tenant.status;
  await tenant.save();
  // If it was already suspended (e.g. non-payment) before deletion was requested, it stays frozen.
  if (deletion.previousTenantStatus !== 'suspended') {
    await restoreTenantInfrastructure(tenant._id);
  }
}

/** The OTP window is the only step with a hard deadline; if it lapses the deletion dies and the org returns. */
async function expireIfLapsed(deletion: IOrganisationDeletion, now: Date): Promise<boolean> {
  if (deletion.stage !== 'name_confirmed' || !deletion.otpWindowEndsAt || now < deletion.otpWindowEndsAt) return false;

  deletion.stage = 'expired';
  deletion.expiredAt = now;
  await record(deletion, { stage: 'expired', action: 'expired', success: true, message: 'The OTP deletion window lapsed without being started.' }, null, null, now);
  await deletion.save();
  await restoreTenantAfterAbort(deletion);
  return true;
}

export async function getActiveDeletion(input: Pick<StageInput, 'tenantId' | 'actor' | 'now'>): Promise<DeletionView | null> {
  const now = input.now ?? new Date();
  assertAuthorised(input.actor, input.tenantId);

  const deletion = await OrganisationDeletionModel.findOne({ tenantId: input.tenantId, stage: { $in: ACTIVE_DELETION_STAGES } });
  if (!deletion) return null;
  if (await expireIfLapsed(deletion, now)) return null;
  return toDeletionView(deletion);
}

export async function cancelDeletion(input: StageInput): Promise<DeletionView> {
  const { tenantId, actor, context } = input;
  const now = input.now ?? new Date();
  assertAuthorised(actor, tenantId);

  const deletion = await loadActive(tenantId);
  deletion.stage = 'cancelled';
  deletion.cancelledAt = now;
  deletion.finalOtp.codeHash = null;
  await record(deletion, { stage: 'cancelled', action: 'cancelled', success: true }, actor, context, now);
  await deletion.save();
  await restoreTenantAfterAbort(deletion);

  return toDeletionView(deletion);
}

// ---------------------------------------------------------------------------
// stage 3 — initiate the OTP deletion process
// ---------------------------------------------------------------------------

export async function initiateOtpProcess(input: StageInput): Promise<DeletionView> {
  const { tenantId, actor, context } = input;
  const now = input.now ?? new Date();
  assertAuthorised(actor, tenantId);

  const deletion = await loadActive(tenantId);
  if (await expireIfLapsed(deletion, now)) {
    throw new OrganisationDeletionError(
      'The 24-hour OTP deletion window has lapsed. The organisation has been restored; start a new deletion request if you still want to proceed.',
      'OTP_WINDOW_EXPIRED',
      410
    );
  }
  if (deletion.stage !== 'name_confirmed') throw wrongStage(deletion, 'name_confirmed');

  const early = requireAvailable(deletion.securityWaitEndsAt, now);
  if (early) return failStep(deletion, 'otp_initiated', 'otp_initiation_failed', actor, context, now, early);

  deletion.stage = 'otp_initiated';
  deletion.otpInitiatedAt = now;
  deletion.finalLockEndsAt = new Date(now.getTime() + DELETION_TIMINGS.finalLockMs);
  deletion.otpVerification = 'pending';
  await record(deletion, { stage: 'otp_initiated', action: 'otp_initiated', success: true }, actor, context, now);
  await deletion.save();

  return toDeletionView(deletion);
}

// ---------------------------------------------------------------------------
// stage 4 — final OTP: generate, then verify
// ---------------------------------------------------------------------------

const hashOtp = (code: string) => crypto.createHash('sha256').update(code).digest('hex');

export async function generateFinalOtp(input: StageInput): Promise<DeletionView> {
  const { tenantId, actor, context } = input;
  const now = input.now ?? new Date();
  assertAuthorised(actor, tenantId);

  const deletion = await loadActive(tenantId);
  // Re-generating is allowed while a code is outstanding (lost email, locked out after bad attempts).
  if (deletion.stage !== 'otp_initiated' && deletion.stage !== 'final_otp_sent') {
    throw wrongStage(deletion, 'otp_initiated');
  }

  const early = requireAvailable(deletion.finalLockEndsAt, now);
  if (early) return failStep(deletion, 'otp_generation', 'otp_generation_failed', actor, context, now, early);

  const code = crypto.randomInt(100000, 1000000).toString();
  const delivery = await emailService.sendOrganisationDeletionOtpEmail({
    to: actor.email,
    recipientName: actor.name ?? undefined,
    otpCode: code,
    expiresMinutes: DELETION_TIMINGS.finalOtpTtlMs / 60000,
    organisationName: deletion.organisationName,
  });
  if (!delivery.success) {
    return failStep(
      deletion,
      'otp_generation',
      'otp_generation_failed',
      actor,
      context,
      now,
      new OrganisationDeletionError('We could not email the verification code. Please try again.', 'OTP_DELIVERY_FAILED', 502)
    );
  }

  deletion.stage = 'final_otp_sent';
  deletion.otpVerification = 'pending';
  deletion.finalOtp = {
    codeHash: hashOtp(code),
    expiresAt: new Date(now.getTime() + DELETION_TIMINGS.finalOtpTtlMs),
    attempts: 0,
    issuedToUserId: actor.id,
  };
  await record(deletion, { stage: 'otp_generation', action: 'final_otp_generated', success: true }, actor, context, now);
  await deletion.save();

  return toDeletionView(deletion);
}

export async function verifyFinalOtp(input: StageInput & { code: string }): Promise<DeletionView> {
  const { tenantId, actor, context } = input;
  const now = input.now ?? new Date();
  assertAuthorised(actor, tenantId);

  const deletion = await loadActive(tenantId);
  if (deletion.stage !== 'final_otp_sent') throw wrongStage(deletion, 'final_otp_sent');

  const fail = (code: string, message: string, status: number) =>
    failStep(deletion, 'otp_verified', 'otp_verification_failed', actor, context, now, new OrganisationDeletionError(message, code, status));

  if (deletion.finalOtp.issuedToUserId !== actor.id) {
    return fail('OTP_ISSUED_TO_ANOTHER_USER', 'This code was issued to a different administrator.', 403);
  }
  if (!deletion.finalOtp.expiresAt || now > deletion.finalOtp.expiresAt) {
    return fail('OTP_EXPIRED', 'The verification code has expired. Generate a new one.', 400);
  }
  // Claim an attempt atomically *before* comparing, so parallel guesses cannot exceed the cap
  // (a read-modify-save counter would let concurrent requests all pass the check).
  const claimed = await OrganisationDeletionModel.updateOne(
    { _id: deletion._id, stage: 'final_otp_sent', 'finalOtp.attempts': { $lt: DELETION_TIMINGS.maxOtpAttempts } },
    { $inc: { 'finalOtp.attempts': 1 } }
  );
  if (claimed.modifiedCount === 0) {
    return fail('OTP_LOCKED', 'Too many incorrect attempts. Generate a new code.', 429);
  }

  const submitted = Buffer.from(hashOtp(String(input.code ?? '').trim()));
  const stored = Buffer.from(deletion.finalOtp.codeHash ?? '');
  const matches = submitted.length === stored.length && crypto.timingSafeEqual(submitted, stored);
  if (!matches) {
    deletion.otpVerification = 'failed';
    return fail('INVALID_OTP', 'Incorrect verification code.', 400);
  }

  deletion.stage = 'otp_verified';
  deletion.otpVerification = 'verified';
  deletion.otpVerifiedAt = now;
  deletion.finalOtp.codeHash = null;
  await record(deletion, { stage: 'otp_verified', action: 'otp_verified', success: true }, actor, context, now);
  await deletion.save();

  return toDeletionView(deletion);
}

// ---------------------------------------------------------------------------
// stage 5 — final confirmation → permanent deletion
// ---------------------------------------------------------------------------

async function blockRegistrationIdentity(deletion: IOrganisationDeletion, now: Date): Promise<void> {
  if (!deletion.registrationEmail || !deletion.registrationEmailNormalized) return;

  await BlockedRegistrationIdentityModel.updateOne(
    { emailNormalized: deletion.registrationEmailNormalized },
    { $setOnInsert: { originalEmail: deletion.registrationEmail, deletionId: deletion._id, blockedAt: now } },
    { upsert: true }
  );
  deletion.reRegistration.status = 'blocked';
  deletion.emailRestriction = {
    email: deletion.registrationEmail,
    normalized: deletion.registrationEmailNormalized,
    blockedAt: now,
    permanent: true,
  };
}

export async function completeDeletion(input: StageInput): Promise<DeletionView> {
  const { tenantId, actor, context } = input;
  const now = input.now ?? new Date();
  assertAuthorised(actor, tenantId);

  const deletion = await loadActive(tenantId);
  if (deletion.stage !== 'otp_verified') throw wrongStage(deletion, 'otp_verified');

  if (deletion.finalOtp.issuedToUserId !== actor.id) {
    return failStep(
      deletion,
      'final_confirmation',
      'final_confirmation_failed',
      actor,
      context,
      now,
      new OrganisationDeletionError('The final confirmation must come from the administrator who verified the code.', 'OTP_ISSUED_TO_ANOTHER_USER', 403)
    );
  }

  return finaliseDeletion(deletion, actor, context, now);
}

/** Purge → block the registration email → stamp the permanent record complete. Shared with the forced path. */
async function finaliseDeletion(
  deletion: IOrganisationDeletion,
  actor: DeletionActor,
  context: RequestContext,
  now: Date,
  message?: string
): Promise<DeletionView> {
  // Block first: if we crash after the purge the identity is already barred, and retries are idempotent.
  await blockRegistrationIdentity(deletion, now);
  try {
    await purgeTenant(deletion.tenantId);
  } catch (err: any) {
    return failStep(
      deletion,
      'final_confirmation',
      'final_confirmation_failed',
      actor,
      context,
      now,
      new OrganisationDeletionError(`Deletion failed part-way (${err.message}). It is safe to retry the final confirmation.`, 'PURGE_FAILED', 500)
    );
  }

  deletion.stage = 'completed';
  deletion.completedAt = now;
  deletion.completedBy = actorSnapshot(actor, deletion);
  deletion.completedNetwork = networkSnapshot(context);
  await record(deletion, { stage: 'final_confirmation', action: 'completed', success: true, message }, actor, context, now);
  await deletion.save();

  return toDeletionView(deletion);
}

/**
 * Super-admin emergency delete: skips the security timeline (no suspension, name entry or OTPs)
 * but is still fully attributed — the same permanent record is written and the registration
 * email is blocked, so "who deleted it, from where" always has an answer.
 */
export async function forceDeleteOrganisation(input: StageInput & { reason?: string | null }): Promise<DeletionView> {
  const { tenantId, actor, context } = input;
  const now = input.now ?? new Date();
  if (actor.role !== 'SUPER_ADMIN') {
    throw new OrganisationDeletionError('Only a Super Admin can force-delete an organisation.', 'FORBIDDEN', 403);
  }

  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new OrganisationDeletionError('Organisation not found.', 'TENANT_NOT_FOUND', 404);

  // Reuse an in-flight standard deletion's record rather than fighting the one-active-per-org index.
  const inFlight = await OrganisationDeletionModel.findOne({ tenantId, stage: { $in: ACTIVE_DELETION_STAGES } });
  let deletion: IOrganisationDeletion;
  if (inFlight) {
    inFlight.path = 'forced';
    deletion = inFlight;
  } else {
    deletion = await createDeletionRecord(tenant, input, now, 'forced');
    await record(deletion, { stage: 'requested', action: 'requested', success: true, message: input.reason?.trim() || undefined }, actor, context, now);
  }

  return finaliseDeletion(deletion, actor, context, now, 'Forced immediate deletion by Super Admin — the security timeline was bypassed.');
}

// ---------------------------------------------------------------------------
// reading the permanent record (Super Admin "Deleted Organisations")
// ---------------------------------------------------------------------------

/** API shape of a record. The OTP hash/attempt state is never exposed. */
export function serializeAuditRecord(doc: IOrganisationDeletion, opts: { includeTimeline: boolean }) {
  const { _id, tenantId, finalOtp: _finalOtp, timeline, ...rest } = doc.toObject({ versionKey: false });
  return {
    ...rest,
    id: _id.toString(),
    organisationId: tenantId.toString(),
    ...(opts.includeTimeline ? { timeline } : { timelineLength: timeline.length }),
  };
}

export interface ListDeletionRecordsParams {
  /** 'completed' = the Deleted Organisations list; 'active' = still in the security timeline. */
  stage?: 'completed' | 'active' | 'all';
  search?: string;
  page?: number;
  limit?: number;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function listDeletionRecords(params: ListDeletionRecordsParams) {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(params.limit ?? 25)));
  const stage = params.stage ?? 'completed';

  const filter: Record<string, unknown> = {};
  if (stage === 'completed') filter.stage = 'completed';
  else if (stage === 'active') filter.stage = { $in: ACTIVE_DELETION_STAGES };

  const term = params.search?.trim();
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i');
    filter.$or = [{ organisationName: rx }, { registrationEmail: rx }, { domains: rx }];
  }

  const [docs, total] = await Promise.all([
    OrganisationDeletionModel.find(filter)
      .sort({ completedAt: -1, initiatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    OrganisationDeletionModel.countDocuments(filter),
  ]);

  return { items: docs.map((d) => serializeAuditRecord(d, { includeTimeline: false })), total, page, limit };
}

export async function getDeletionRecord(id: string) {
  const doc = await OrganisationDeletionModel.findById(id);
  return doc ? serializeAuditRecord(doc, { includeTimeline: true }) : null;
}

/** Background sweep: lapse deletions whose OTP window ran out with nobody calling in. */
export async function expireStaleDeletions(now: Date = new Date()): Promise<number> {
  const stale = await OrganisationDeletionModel.find({ stage: 'name_confirmed', otpWindowEndsAt: { $lte: now } });
  let expired = 0;
  for (const deletion of stale) {
    if (await expireIfLapsed(deletion, now)) expired++;
  }
  return expired;
}
