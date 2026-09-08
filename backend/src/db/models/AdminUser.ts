import mongoose, { Schema, Document, Types } from 'mongoose';

export type AdminRole = 'SUPER_ADMIN' | 'TENANT_ADMIN';
export type AdminUserStatus = 'active' | 'disabled';

export interface ISecurityQuestionItem {
  question: string;
  answerHash: string;
}

export interface IAdminUser extends Document {
  email: string;
  name?: string | null;
  passwordHash: string;
  role: AdminRole;
  tenantId?: Types.ObjectId | null;
  status: AdminUserStatus;
  twoFactorEnabled: boolean;
  twoFactorSecret?: string | null;
  recoveryEmail?: string | null;
  securityQuestions?: ISecurityQuestionItem[];
  loginOtp?: {
    codeHash: string;
    expiresAt: Date;
    attempts: number;
  } | null;
  passwordResetOtp?: {
    codeHash: string;
    expiresAt: Date;
    attempts: number;
  } | null;
  passwordResetToken?: {
    tokenHash: string;
    expiresAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const AdminUserSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      default: null,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['SUPER_ADMIN', 'TENANT_ADMIN'],
      required: true,
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId as any,
      ref: 'Tenant',
      default: null,
      index: true,
      validate: {
        validator: function (this: IAdminUser, value: Types.ObjectId | null) {
          if (this.role === 'SUPER_ADMIN') {
            return value === null || value === undefined;
          }
          if (this.role === 'TENANT_ADMIN') {
            return value !== null && value !== undefined;
          }
          return false;
        },
        message: 'SUPER_ADMIN must not have a tenantId; TENANT_ADMIN must have a tenantId',
      },
    },
    status: {
      type: String,
      enum: ['active', 'disabled'],
      default: 'active',
      index: true,
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecret: {
      type: String,
      default: null,
    },
    recoveryEmail: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },
    securityQuestions: [
      {
        question: { type: String, required: true },
        answerHash: { type: String, required: true },
        _id: false,
      },
    ],
    loginOtp: {
      codeHash: { type: String, default: null },
      expiresAt: { type: Date, default: null },
      attempts: { type: Number, default: 0 },
    },
    passwordResetOtp: {
      codeHash: { type: String, default: null },
      expiresAt: { type: Date, default: null },
      attempts: { type: Number, default: 0 },
    },
    passwordResetToken: {
      tokenHash: { type: String, default: null },
      expiresAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
    collection: 'admin_users',
  }
);

AdminUserSchema.index({ tenantId: 1, email: 1 });
AdminUserSchema.index({ role: 1, status: 1 });

export const AdminUserModel = mongoose.model<IAdminUser>('AdminUser', AdminUserSchema);
