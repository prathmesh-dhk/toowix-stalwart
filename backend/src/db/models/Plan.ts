import mongoose, { Schema, Document } from 'mongoose';

export type PlanBillingMode = 'fixed' | 'metered';

export interface IPlan extends Document {
  name: string;
  badge?: string | null;
  description?: string | null;
  seatCount: number;
  displayOrder: number;
  isActive: boolean;
  isDefault: boolean;
  // Billing (see backend/src/services/billing.service.ts):
  // 'fixed' = flat committed price for seatCount seats, charged in full
  // regardless of actual usage, hard-blocked on overage.
  // 'metered' = pay-as-you-go, Stripe reports actual mailbox count with
  // `max` aggregation; seatCount is not used for pricing on this mode.
  billingMode: PlanBillingMode;
  monthlyPriceInPaise: number;
  stripePriceId?: string | null;
  // Only set for billingMode 'metered' — the Stripe Billing Meter this
  // plan's Price reports usage against. See backend/src/stripe/client.ts.
  stripeMeterId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const PlanSchema = new Schema<IPlan>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    badge: {
      type: String,
      default: null,
      trim: true,
    },
    description: {
      type: String,
      default: null,
      trim: true,
    },
    seatCount: {
      type: Number,
      required: true,
      min: 1,
    },
    displayOrder: {
      type: Number,
      required: true,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
      index: true,
    },
    billingMode: {
      type: String,
      enum: ['fixed', 'metered'],
      default: 'fixed',
    },
    monthlyPriceInPaise: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    stripePriceId: {
      type: String,
      default: null,
    },
    stripeMeterId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'plans',
  }
);

PlanSchema.index({ isActive: 1, displayOrder: 1 });

export const PlanModel = mongoose.model<IPlan>('Plan', PlanSchema);
