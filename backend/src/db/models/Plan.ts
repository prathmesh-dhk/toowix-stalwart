import mongoose, { Schema, Document } from 'mongoose';

export type PlanBillingMode = 'fixed' | 'metered';

export interface IPlan extends Document {
  name: string;
  badge?: string | null;
  description?: string | null;
  // Plan capacity ceiling (maximum active users allowed for domain)
  seatCount: number;
  maxUsers?: number;
  displayOrder: number;
  isActive: boolean;
  isDefault: boolean;
  // Billing (see backend/src/services/billing.service.ts):
  // Pay-as-you-go per active user: monthlyPriceInPaise is the price per active user per month.
  // Capacity ceiling is defined by seatCount / maxUsers.
  billingMode: PlanBillingMode;
  monthlyPriceInPaise: number;
  pricePerUserMonthlyPaise?: number;
  stripePriceId?: string | null;
  // Only set for billingMode 'metered' — the Stripe Billing Meter this
  // plan's Price reports usage against. See backend/src/stripe/client.ts.
  stripeMeterId?: string | null;
  storageQuotaGb?: number | null;
  apps?: string[];
  features?: string[];
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
    storageQuotaGb: {
      type: Number,
      default: null,
    },
    apps: {
      type: [String],
      default: ['email'],
    },
    features: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'plans',
  }
);

PlanSchema.index({ isActive: 1, displayOrder: 1 });

export const PlanModel = mongoose.model<IPlan>('Plan', PlanSchema);
