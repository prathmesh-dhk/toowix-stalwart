import mongoose, { Schema, Document, Types } from 'mongoose';

import { ISecurityQuestionItem } from './AdminUser';

export type ApplicationStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export interface IRegistrationApplication extends Document {
  companyName: string;
  requestedDomain: string;
  applicantName: string;
  contactEmail: string;
  contactEmailVerified?: boolean;
  recoveryEmail?: string | null;
  recoveryEmailVerified?: boolean;
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string | null;
  securityQuestions?: ISecurityQuestionItem[];
  phone?: string | null;
  notes?: string | null;
  employeeCount?: string | null;
  region?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  passwordHash?: string | null;
  status: ApplicationStatus;
  rejectionReason?: string | null;
  reviewedBy?: Types.ObjectId | null;
  reviewedAt?: Date | null;
  tenantId?: Types.ObjectId | null;
  domainId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const RegistrationApplicationSchema = new Schema<IRegistrationApplication>(
  {
    companyName: {
      type: String,
      required: true,
      trim: true,
    },
    requestedDomain: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    applicantName: {
      type: String,
      required: true,
      trim: true,
    },
    contactEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    contactEmailVerified: {
      type: Boolean,
      default: false,
    },
    recoveryEmail: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },
    recoveryEmailVerified: {
      type: Boolean,
      default: false,
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecret: {
      type: String,
      default: null,
    },
    securityQuestions: [
      {
        question: { type: String, required: true },
        answerHash: { type: String, required: true },
        _id: false,
      },
    ],
    phone: {
      type: String,
      default: null,
      trim: true,
    },
    notes: {
      type: String,
      default: null,
    },
    employeeCount: {
      type: String,
      default: null,
    },
    region: {
      type: String,
      default: null,
    },
    firstName: {
      type: String,
      default: null,
      trim: true,
    },
    lastName: {
      type: String,
      default: null,
      trim: true,
    },
    passwordHash: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['PENDING_REVIEW', 'APPROVED', 'REJECTED'],
      default: 'PENDING_REVIEW',
      index: true,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },
    domainId: {
      type: Schema.Types.ObjectId,
      ref: 'Domain',
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'registration_applications',
  }
);

RegistrationApplicationSchema.index({ status: 1, createdAt: -1 });
RegistrationApplicationSchema.index({ tenantId: 1, requestedDomain: 1 });

export const RegistrationApplicationModel = mongoose.model<IRegistrationApplication>(
  'RegistrationApplication',
  RegistrationApplicationSchema
);
