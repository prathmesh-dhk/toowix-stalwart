import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Permanent audit record of an organisation's deletion ("Deleted Organisations").
 *
 * Deliberately standalone: tenantId is a plain ObjectId (no ref, no cascade) and
 * every fact about the org (name, registration email, domains, created date) is
 * copied in at request time, so this document is still complete after the Tenant,
 * its admins and its domains have been purged. Never deleted by the cascade.
 */

export type DeletionStage =
  | 'requested'
  | 'name_confirmed'
  | 'otp_initiated'
  | 'final_otp_sent'
  | 'otp_verified'
  | 'completed'
  | 'cancelled'
  | 'expired';

export const ACTIVE_DELETION_STAGES: DeletionStage[] = [
  'requested',
  'name_confirmed',
  'otp_initiated',
  'final_otp_sent',
  'otp_verified',
];

/** Timeline stages — the spec's security steps, in order, plus the failure-only/terminal ones. */
export type TimelineStage = DeletionStage | 'otp_generation' | 'final_confirmation';

export interface IDeletionActor {
  userId: string;
  name: string | null;
  email: string;
  role: 'SUPER_ADMIN' | 'TENANT_ADMIN';
  organisationId: string;
  organisationName: string;
}

export interface IDeletionNetwork {
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

export interface IDeletionTimelineEntry {
  stage: TimelineStage;
  action: string;
  success: boolean;
  at: Date;
  message?: string | null;
  /** null = the system itself (e.g. the OTP window lapsing with nobody acting). */
  actor: IDeletionActor | null;
  network: IDeletionNetwork | null;
}

export interface IOrganisationDeletion extends Document {
  tenantId: Types.ObjectId;
  organisationName: string;
  registrationEmail: string | null;
  registrationEmailNormalized: string | null;
  domains: string[];
  organisationCreatedAt: Date;
  previousTenantStatus: string;
  path: 'standard' | 'forced';
  reason: string | null;

  stage: DeletionStage;
  initiatedAt: Date;
  initiatedBy: IDeletionActor;
  initiatedNetwork: IDeletionNetwork;
  completedAt: Date | null;
  completedBy: IDeletionActor | null;
  completedNetwork: IDeletionNetwork | null;
  cancelledAt: Date | null;
  expiredAt: Date | null;

  suspensionEndsAt: Date;
  nameConfirmedAt: Date | null;
  securityWaitEndsAt: Date | null;
  otpWindowEndsAt: Date | null;
  otpInitiatedAt: Date | null;
  finalLockEndsAt: Date | null;
  otpVerifiedAt: Date | null;

  otpVerification: 'not_started' | 'pending' | 'verified' | 'failed';
  finalOtp: {
    codeHash: string | null;
    expiresAt: Date | null;
    attempts: number;
    issuedToUserId: string | null;
  };

  timeline: IDeletionTimelineEntry[];

  reRegistration: {
    status: 'none' | 'blocked';
    blockedAttempts: { at: Date; ip: string; location: string; source: string }[];
  };
  emailRestriction: {
    email: string | null;
    normalized: string | null;
    blockedAt: Date | null;
    permanent: boolean;
  };

  createdAt: Date;
  updatedAt: Date;
}

const ActorSchema = new Schema<IDeletionActor>(
  {
    userId: { type: String, required: true },
    name: { type: String, default: null },
    email: { type: String, required: true },
    role: { type: String, enum: ['SUPER_ADMIN', 'TENANT_ADMIN'], required: true },
    organisationId: { type: String, required: true },
    organisationName: { type: String, required: true },
  },
  { _id: false }
);

const NetworkSchema = new Schema<IDeletionNetwork>(
  {
    ip: { type: String, required: true },
    ipVersion: { type: Number, enum: [4, 6, null], default: null },
    location: { type: String, default: 'Unknown Location' },
    countryCode: { type: String, default: null },
    deviceType: { type: String, default: 'unknown' },
    os: { type: String, default: 'Unknown OS' },
    browser: { type: String, default: 'Unknown Browser' },
    browserVersion: { type: String, default: '' },
    sessionId: { type: String, default: null },
  },
  { _id: false }
);

const TimelineEntrySchema = new Schema<IDeletionTimelineEntry>(
  {
    stage: { type: String, required: true },
    action: { type: String, required: true },
    success: { type: Boolean, required: true },
    at: { type: Date, required: true },
    message: { type: String, default: null },
    actor: { type: ActorSchema, default: null },
    network: { type: NetworkSchema, default: null },
  },
  { _id: false }
);

const OrganisationDeletionSchema = new Schema<IOrganisationDeletion>(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    organisationName: { type: String, required: true },
    registrationEmail: { type: String, default: null },
    registrationEmailNormalized: { type: String, default: null, index: true },
    domains: { type: [String], default: [] },
    organisationCreatedAt: { type: Date, required: true },
    previousTenantStatus: { type: String, required: true },
    path: { type: String, enum: ['standard', 'forced'], default: 'standard' },
    reason: { type: String, default: null },

    stage: {
      type: String,
      enum: ['requested', 'name_confirmed', 'otp_initiated', 'final_otp_sent', 'otp_verified', 'completed', 'cancelled', 'expired'],
      default: 'requested',
      index: true,
    },
    initiatedAt: { type: Date, required: true },
    initiatedBy: { type: ActorSchema, required: true },
    initiatedNetwork: { type: NetworkSchema, required: true },
    completedAt: { type: Date, default: null },
    completedBy: { type: ActorSchema, default: null },
    completedNetwork: { type: NetworkSchema, default: null },
    cancelledAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },

    suspensionEndsAt: { type: Date, required: true },
    nameConfirmedAt: { type: Date, default: null },
    securityWaitEndsAt: { type: Date, default: null },
    otpWindowEndsAt: { type: Date, default: null },
    otpInitiatedAt: { type: Date, default: null },
    finalLockEndsAt: { type: Date, default: null },
    otpVerifiedAt: { type: Date, default: null },

    otpVerification: { type: String, enum: ['not_started', 'pending', 'verified', 'failed'], default: 'not_started' },
    finalOtp: {
      codeHash: { type: String, default: null },
      expiresAt: { type: Date, default: null },
      attempts: { type: Number, default: 0 },
      issuedToUserId: { type: String, default: null },
    },

    timeline: { type: [TimelineEntrySchema], default: [] },

    reRegistration: {
      // 'none' until the registration email is actually blocked (completion) — and stays 'none' if the org had no email.
      status: { type: String, enum: ['none', 'blocked'], default: 'none' },
      blockedAttempts: {
        type: [
          new Schema(
            {
              at: { type: Date, required: true },
              ip: { type: String, default: 'unknown' },
              location: { type: String, default: 'Unknown Location' },
              source: { type: String, required: true },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
    },
    emailRestriction: {
      email: { type: String, default: null },
      normalized: { type: String, default: null },
      blockedAt: { type: Date, default: null },
      permanent: { type: Boolean, default: true },
    },
  },
  { timestamps: true, collection: 'organisation_deletions' }
);

// At most one in-flight deletion per organisation (terminal records are kept forever).
OrganisationDeletionSchema.index(
  { tenantId: 1 },
  { unique: true, partialFilterExpression: { stage: { $in: ACTIVE_DELETION_STAGES } } }
);
OrganisationDeletionSchema.index({ tenantId: 1, createdAt: -1 });
OrganisationDeletionSchema.index({ completedAt: -1 });

export const OrganisationDeletionModel = mongoose.model<IOrganisationDeletion>(
  'OrganisationDeletion',
  OrganisationDeletionSchema
);
