import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Registration identities (emails) that may never register again because the
 * organisation registered with them was deleted. Keyed on the normalized email
 * (see utils/email-identity.ts) — never on organisation name or domain — so a
 * re-registration cannot slip through by renaming the org or re-casing the email.
 */
export interface IBlockedRegistrationIdentity extends Document {
  emailNormalized: string;
  originalEmail: string;
  deletionId: Types.ObjectId;
  blockedAt: Date;
}

const BlockedRegistrationIdentitySchema = new Schema<IBlockedRegistrationIdentity>(
  {
    emailNormalized: { type: String, required: true, unique: true, index: true },
    originalEmail: { type: String, required: true },
    deletionId: { type: Schema.Types.ObjectId, required: true, index: true },
    blockedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, collection: 'blocked_registration_identities' }
);

export const BlockedRegistrationIdentityModel = mongoose.model<IBlockedRegistrationIdentity>(
  'BlockedRegistrationIdentity',
  BlockedRegistrationIdentitySchema
);
