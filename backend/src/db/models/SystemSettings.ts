import mongoose, { Schema, Document } from 'mongoose';

export interface ISystemSettings extends Document {
  key: string;
  webhookUrl?: string;
  alertEmail?: string;
  alertsEnabled: boolean;
  consecutiveFailureThreshold: number;
  attachmentSizeMb?: number;
  messageSizeMb?: number;
  maxMailboxDepth?: number;
  maxMailboxNameLength?: number;
  dnsActivationMaxHours?: number;
  dnsSweepIntervalMinutes?: number;
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
    attachmentSizeMb: {
      type: Number,
      default: 5,
      min: 1,
    },
    messageSizeMb: {
      type: Number,
      default: 6,
      min: 1,
    },
    maxMailboxDepth: {
      type: Number,
      default: 10,
      min: 1,
    },
    maxMailboxNameLength: {
      type: Number,
      default: 255,
      min: 1,
    },
    dnsActivationMaxHours: {
      type: Number,
      default: 48,
      min: 1,
    },
    dnsSweepIntervalMinutes: {
      type: Number,
      default: 15,
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
