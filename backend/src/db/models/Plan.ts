import mongoose, { Schema, Document } from 'mongoose';

export interface IPlan extends Document {
  name: string;
  badge?: string | null;
  description?: string | null;
  seatCount: number;
  displayOrder: number;
  isActive: boolean;
  isDefault: boolean;
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
  },
  {
    timestamps: true,
    collection: 'plans',
  }
);

PlanSchema.index({ isActive: 1, displayOrder: 1 });

export const PlanModel = mongoose.model<IPlan>('Plan', PlanSchema);
