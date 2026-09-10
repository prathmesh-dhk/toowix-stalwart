import mongoose, { Document, Schema, Types } from 'mongoose';

export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'unknown';

export interface IAdminSession extends Document {
  userId: Types.ObjectId;
  sessionId: string;
  userAgent: string;
  deviceType: DeviceType;
  browser: string;
  os: string;
  ipAddress: string;
  location?: string;
  countryCode?: string;
  lastActiveAt: Date;
  expiresAt: Date;
  isRevoked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AdminSessionSchema = new Schema<IAdminSession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userAgent: {
      type: String,
      default: 'Unknown User-Agent',
    },
    deviceType: {
      type: String,
      enum: ['desktop', 'mobile', 'tablet', 'unknown'],
      default: 'unknown',
    },
    browser: {
      type: String,
      default: 'Unknown Browser',
    },
    os: {
      type: String,
      default: 'Unknown OS',
    },
    ipAddress: {
      type: String,
      default: 'unknown',
    },
    location: {
      type: String,
      default: 'Localhost',
    },
    countryCode: {
      type: String,
      default: null,
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    isRevoked: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying active sessions for a user
AdminSessionSchema.index({ userId: 1, isRevoked: 1, expiresAt: 1 });

export const AdminSessionModel = mongoose.model<IAdminSession>('AdminSession', AdminSessionSchema);
