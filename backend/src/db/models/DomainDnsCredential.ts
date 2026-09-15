import mongoose, { Schema, Document, Types } from 'mongoose';

export type DnsProviderName = 'godaddy' | 'hostinger';

/**
 * Tenant-supplied DNS provider credential for one domain's DNS activation.
 * Provider-agnostic: `credentialEncrypted` holds an encrypted JSON blob
 * whose shape depends on `provider` (e.g. GoDaddy needs {apiKey, apiSecret},
 * Hostinger needs {token}) — see backend/src/dns-providers/dispatch.ts.
 * Kept in its own collection (never embedded on Domain) so it never rides
 * along with normal Domain reads/dashboards, and so a successful activation
 * can simply delete the whole document rather than scrub fields in place.
 * Per the requirements doc, this authorization is not retained permanently:
 * it is deleted once the domain's dnsStatus reaches 'active'.
 */
export interface IDomainDnsCredential extends Document {
  domainId: Types.ObjectId;
  tenantId: Types.ObjectId;
  provider: DnsProviderName;
  credentialEncrypted: string;
  verifiedProviderDomain: string;
  connectedAt: Date;
  connectedBy: Types.ObjectId;
  lastUsedAt?: Date | null;
  revokedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const DomainDnsCredentialSchema = new Schema<IDomainDnsCredential>(
  {
    domainId: {
      type: Schema.Types.ObjectId,
      ref: 'Domain',
      required: true,
      unique: true,
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ['godaddy', 'hostinger'],
      required: true,
    },
    credentialEncrypted: {
      type: String,
      required: true,
      select: false,
    },
    verifiedProviderDomain: {
      type: String,
      required: true,
    },
    connectedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    connectedBy: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: true,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'domain_dns_credentials',
  }
);

export const DomainDnsCredentialModel = mongoose.model<IDomainDnsCredential>(
  'DomainDnsCredential',
  DomainDnsCredentialSchema
);
