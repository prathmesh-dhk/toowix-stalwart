import mongoose, { Schema, Document, Types } from 'mongoose';

export type DomainSubscriptionStatus =
  | 'not_started'
  | 'incomplete'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'grace'
  | 'read_only'
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
  // Pay-as-you-go active user tracking (capacity ceiling vs active users):
  activeUserCount?: number;
  maxUsers?: number;
  pricePerUserMonthlyPaise?: number;
  // Set the moment a renewal/trial-end charge fails (status flips to
  // 'grace'); the billing-grace-sweep job suspends the domain once this
  // passes. Cleared on successful payment.
  gracePeriodEndsAt?: Date | null;
  graceNoticesSent?: number[];
  lastPaymentFailedInvoiceId?: string | null;
  // Hosted invoice page where the Tenant Admin completes 3-D Secure; cleared on successful payment.
  paymentActionUrl?: string | null;
  lastPaymentRetryAt?: Date | null;
  readOnlyUntil?: Date | null;
  retentionEndsAt?: Date | null;
  deletionScheduledAt?: Date | null;
  cancelAtPeriodEnd: boolean;
  // Metered (Custom plan) domains only. Stripe's Billing Meters API only
  // supports 'sum'/'count'/'last' aggregation, not 'max' — the confirmed
  // design needs peak-during-period billing (protects against create-then-
  // delete-before-renewal gaming). Achieved on top of 'last' aggregation:
  // every usage report sends max(peakMailboxCountThisPeriod, currentCount)
  // as the event value, so whatever was LAST reported at period-close IS
  // the period's peak. Reset to 0 when a new billing period starts.
  peakMailboxCountThisPeriod: number;
  // A downgrade waiting for the next renewal. These rows are what the subscription's Stripe
  // schedule is rebuilt from (see syncPendingDowngrades in billing.service.ts).
  pendingDowngradePlanId?: Types.ObjectId | null;
  // The Stripe price that downgrade moves this domain's item to; the schedule is rebuilt from it.
  pendingDowngradePriceId?: string | null;
  // Meter-era: a Price/Meter dedicated to this domain. No path sets these any more; existing rows
  // may still carry them until a plan change clears them.
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
      enum: ['not_started', 'incomplete', 'trialing', 'active', 'past_due', 'grace', 'read_only', 'suspended', 'canceled'],
      default: 'incomplete',
      index: true,
    },
    activeUserCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxUsers: {
      type: Number,
      default: 10,
      min: 1,
    },
    pricePerUserMonthlyPaise: {
      type: Number,
      default: 0,
      min: 0,
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
    graceNoticesSent: {
      type: [Number],
      default: [],
    },
    lastPaymentFailedInvoiceId: {
      type: String,
      default: null,
    },
    paymentActionUrl: {
      type: String,
      default: null,
    },
    lastPaymentRetryAt: {
      type: Date,
      default: null,
    },
    readOnlyUntil: {
      type: Date,
      default: null,
    },
    retentionEndsAt: {
      type: Date,
      default: null,
    },
    deletionScheduledAt: {
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
    pendingDowngradePriceId: {
      type: String,
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
