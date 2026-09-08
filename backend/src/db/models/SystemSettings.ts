import mongoose, { Schema, Document } from 'mongoose';

export interface ISystemSettings extends Document {
  key: string;
  webhookUrl?: string;
  alertEmail?: string;
  alertsEnabled: boolean;
  consecutiveFailureThreshold: number;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SystemSettingsSchema = new Schema<ISystemSettings>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    webhookUrl: {
      type: String,
      trim: true,
    },
    alertEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    alertsEnabled: {
      type: Boolean,
      default: false,
    },
    consecutiveFailureThreshold: {
      type: Number,
      default: 3,
      min: 1,
    },
    updatedBy: {
      type: String,
    },
  },
  {
    timestamps: true,
    collection: 'system_settings',
  }
);

export const SystemSettingsModel = mongoose.model<ISystemSettings>('SystemSettings', SystemSettingsSchema);
