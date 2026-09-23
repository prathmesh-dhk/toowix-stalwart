import mongoose, { Schema, Document, Types } from 'mongoose';

export type DomainSubscriptionStatus =
  | 'incomplete'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'grace'
  | 'suspended'
  | 'canceled';

// One row per Domain (1:1) — own collection, mirroring DomainDnsCredential's reasoning: keeps
// this operational/billing sub-state out of normal Domain reads, and lets a Domain exist happily
// with none of this at all (a domain that never subscribed has no DomainSubscription row — that
// IS the 'never subscribed' state, checked at mailbox-creation time).
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
  // Set only when this domain needed a dedicated Price/Meter because another domain on the
  // same tenant already occupies the plan's shared one (see resolvePriceForDomainAttachment in
  // billing.service.ts). Null means "use the plan's shared price" — the common,
  // single-domain-per-plan case.
  dedicatedStripePriceId?: string | null;
  dedicatedMeterEventName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const DomainSubscriptionSchema = new Schema<IDomainSubscription>(
  {
    domainId: {
      type: Schema.Types.ObjectId,
      ref: 'Domain',
      required: true,
      unique: true,
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
    dedicatedStripePriceId: {
      type: String,
      default: null,
    },
    dedicatedMeterEventName: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'domain_subscriptions',
  }
);

DomainSubscriptionSchema.index({ status: 1, gracePeriodEndsAt: 1 });

export const DomainSubscriptionModel = mongoose.model<IDomainSubscription>(
  'DomainSubscription',
  DomainSubscriptionSchema
);
