import mongoose, { Schema, Document, Types } from 'mongoose';

export type DomainSubscriptionStatus =
  | 'incomplete'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'grace'
  | 'suspended'
  | 'canceled';

// Normally one row per Domain (1:1) — own collection, mirroring DomainDnsCredential's reasoning:
// keeps this operational/billing sub-state out of normal Domain reads, and lets a Domain exist
// happily with none of this at all (a domain that never subscribed has no DomainSubscription row
// — that IS the 'never subscribed' state, checked at mailbox-creation time).
//
// EXCEPTION: the platform's own shared mail domain (config.platformMailDomain, e.g. dhkmail.com —
// see db/seed.ts) is used by MANY tenants as a substitute for owning a domain, so it can have many
// rows, one per tenant. domainId is therefore unique only together with tenantId, not alone — for
// every other (single-owner) domain this is no looser than before, since only that domain's one
// owning tenant will ever create a row against it.
export interface IDomainSubscription extends Document {
  domainId: Types.ObjectId;
  tenantId: Types.ObjectId;
  planId: Types.ObjectId;
  stripeSubscriptionId: string;
  stripeSubscriptionItemId: string;
  status: DomainSubscriptionStatus;
  currentPeriodEnd?: Date | null;
  trialEnd?: Date | null;
  // Set the moment a renewal/trial-end charge fails (status flips to
  // 'grace'); the billing-grace-sweep job suspends the domain once this
  // passes. Cleared on successful payment.
  gracePeriodEndsAt?: Date | null;
  cancelAtPeriodEnd: boolean;
  // Metered (Custom plan) domains only. Stripe's Billing Meters API only
  // supports 'sum'/'count'/'last' aggregation, not 'max' — the confirmed
  // design needs peak-during-period billing (protects against create-then-
  // delete-before-renewal gaming). Achieved on top of 'last' aggregation:
  // every usage report sends max(peakMailboxCountThisPeriod, currentCount)
  // as the event value, so whatever was LAST reported at period-close IS
  // the period's peak. Reset to 0 when a new billing period starts.
  peakMailboxCountThisPeriod: number;
  // Informational mirror of a pending Stripe Subscription Schedule phase
  // change (downgrade scheduled for next renewal) — Stripe's schedule is
  // the actual source of truth; this is for display only.
  pendingDowngradePlanId?: Types.ObjectId | null;
  // Seat cap for THIS row. For a normal domain this mirrors Domain.mailboxLimit (which stays the
  // source of truth there — this field is unused for those). For the shared platform domain,
  // Domain.mailboxLimit is a single field that can't represent many tenants' separate caps, so
  // THIS row is the only place a tenant's shared-domain seat count can live.
  mailboxLimit: number;
  // Atomic counter mirroring mailboxLimit's role: how many mailboxes THIS tenant currently has on
  // the domain this row is for. Only meaningful (and only updated) for the shared platform domain
  // — a normal domain's count is read live via MailboxModel.countDocuments({domainId}) instead,
  // same as always.
  mailboxCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const DomainSubscriptionSchema = new Schema<IDomainSubscription>(
  {
    domainId: {
      type: Schema.Types.ObjectId,
      ref: 'Domain',
      required: true,
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
    },
    stripeSubscriptionId: {
      type: String,
      required: true,
      index: true,
    },
    stripeSubscriptionItemId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['incomplete', 'trialing', 'active', 'past_due', 'grace', 'suspended', 'canceled'],
      default: 'incomplete',
      index: true,
    },
    currentPeriodEnd: {
      type: Date,
      default: null,
    },
    trialEnd: {
      type: Date,
      default: null,
    },
    gracePeriodEndsAt: {
      type: Date,
      default: null,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    peakMailboxCountThisPeriod: {
      type: Number,
      default: 0,
      min: 0,
    },
    pendingDowngradePlanId: {
      type: Schema.Types.ObjectId,
      ref: 'Plan',
      default: null,
    },
    mailboxLimit: {
      type: Number,
      default: 0,
      min: 0,
    },
    mailboxCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    collection: 'domain_subscriptions',
  }
);

DomainSubscriptionSchema.index({ domainId: 1, tenantId: 1 }, { unique: true });
DomainSubscriptionSchema.index({ status: 1, gracePeriodEndsAt: 1 });

export const DomainSubscriptionModel = mongoose.model<IDomainSubscription>(
  'DomainSubscription',
  DomainSubscriptionSchema
);
