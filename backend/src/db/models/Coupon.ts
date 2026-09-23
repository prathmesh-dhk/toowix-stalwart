import mongoose, { Schema, Document, Types } from 'mongoose';

export type CouponStatus = 'active' | 'used' | 'expired' | 'revoked';

export interface ICouponRedemption {
  tenantId: Types.ObjectId;
  domainId?: Types.ObjectId | null;
  redeemedAt: Date;
  extraTrialDays: number;
}

// A coupon does exactly one thing: grant extra free trial days. Earlier revisions also had
// percent/fixed-credit discount types, but those never actually touched Stripe or billing — they
// just showed a "discount applied" message with no real effect — so they were removed rather
// than shipped as a working-looking feature that silently did nothing.
export interface ICoupon extends Document {
  code: string;
  extraTrialDays: number;
  maxUses: number;
  usedCount: number;
  status: CouponStatus;
  expiresAt?: Date | null;
  description?: string | null;
  createdBy?: Types.ObjectId | null;
  redemptions: ICouponRedemption[];
  createdAt: Date;
  updatedAt: Date;
}

const CouponRedemptionSchema = new Schema<ICouponRedemption>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    domainId: {
      type: Schema.Types.ObjectId,
      ref: 'Domain',
      default: null,
    },
    redeemedAt: {
      type: Date,
      default: Date.now,
    },
    extraTrialDays: {
      type: Number,
      required: true,
    },
  },
  { _id: false }
);

const CouponSchema = new Schema<ICoupon>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    extraTrialDays: {
      type: Number,
      required: true,
      min: 1,
      max: 365,
    },
    maxUses: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    usedCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['active', 'used', 'expired', 'revoked'],
      default: 'active',
      index: true,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    description: {
      type: String,
      default: null,
      trim: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      default: null,
    },
    redemptions: {
      type: [CouponRedemptionSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'coupons',
  }
);

CouponSchema.index({ status: 1, expiresAt: 1 });
CouponSchema.index({ createdAt: -1 });

export const CouponModel = mongoose.model<ICoupon>('Coupon', CouponSchema);
