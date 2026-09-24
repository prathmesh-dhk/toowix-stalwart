import mongoose, { Schema, Document } from 'mongoose';

export type TenantStatus =
  | 'pending_review'
  | 'approved_pending_setup'
  | 'active'
  | 'suspended'
  | 'pending_deletion'
  | 'archived';

export interface ITenantPaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
  stripePaymentMethodId?: string | null;
  createdAt: Date;
}

export interface ITenant extends Document {
  name: string;
  contactEmail?: string | null;
  phone?: string | null;
  status: TenantStatus;
  mailboxLimit: number;
  mailboxCount: number;
  trialStartedAt?: Date | null;
  trialEndsAt?: Date | null;
  // One Stripe Customer per Tenant — created lazily on first Checkout for
  // any of the tenant's domains, shared (one payment method) across every
  // domain's own Subscription. See backend/src/services/billing.service.ts.
  stripeCustomerId?: string | null;
  // Master consolidated Stripe Subscription for this tenant
  stripeSubscriptionId?: string | null;
  // Set while a trial activation is in flight so two simultaneous clicks/webhooks can't create two
  // Stripe subscriptions. Stale after 5 minutes.
  activationLock?: Date | null;
  paymentMethods?: ITenantPaymentMethod[];
  trialRemindersSent?: number[];
  cardFingerprint?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const TenantSchema = new Schema<ITenant>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    contactEmail: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: [
        'pending_review',
        'approved_pending_setup',
        'active',
        'suspended',
        'pending_deletion',
        'archived',
      ],
      default: 'approved_pending_setup',
      index: true,
    },
    mailboxLimit: {
      type: Number,
      required: true,
      default: 50,
      min: 1,
    },
    mailboxCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    trialStartedAt: {
      type: Date,
      default: null,
    },
    trialEndsAt: {
      type: Date,
      default: null,
    },
    stripeCustomerId: {
      type: String,
      default: null,
      index: true,
    },
    stripeSubscriptionId: {
      type: String,
      default: null,
      index: true,
    },
    activationLock: {
      type: Date,
      default: null,
    },
    trialRemindersSent: {
      type: [Number],
      default: [],
    },
    cardFingerprint: {
      type: String,
      default: null,
      index: true,
    },
    paymentMethods: [
      {
        id: { type: String, required: true },
        brand: { type: String, required: true },
        last4: { type: String, required: true },
        expMonth: { type: Number, required: true },
        expYear: { type: Number, required: true },
        isDefault: { type: Boolean, default: false },
        stripePaymentMethodId: { type: String, default: null },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
    collection: 'tenants',
  }
);

TenantSchema.index({ status: 1, name: 1 });

export const TenantModel = mongoose.model<ITenant>('Tenant', TenantSchema);
