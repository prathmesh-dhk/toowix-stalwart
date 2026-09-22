export type AdminRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'TENANT_MODERATOR';
export type UserRole = AdminRole;

export interface UserContext {
  id: string;
  email: string;
  role: AdminRole;
  tenantId?: string | null;
  twoFactorEnabled?: boolean;
}

export interface ModeratorItem {
  id: string;
  email: string;
  role: 'TENANT_MODERATOR';
  status: 'active' | 'disabled';
  twoFactorEnabled: boolean;
  scopedDomainIds: string[];
  createdAt: string;
}

export interface RegistrationApplication {
  _id?: string;
  id?: string;
  companyName: string;
  requestedDomain: string;
  applicantName: string;
  contactEmail: string;
  employeeCount?: string | null;
  region?: string | null;
  phone?: string | null;
  notes?: string | null;
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  reviewedBy?: { _id: string; email: string } | string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  tenantId?: string | null;
  domainId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  submittedAt?: string;
}

export type DnsActivationStatus = 'not_started' | 'activating' | 'active' | 'conflict' | 'activation_failed';

export interface GeneratedDnsRecord {
  type: 'MX' | 'TXT' | 'CNAME' | 'SRV' | 'CAA';
  name: string;
  value: string;
  priority?: number | null;
  ttl?: number;
  purpose: string;
  // SRV-specific
  weight?: number | null;
  port?: number | null;
  // CAA-specific
  flags?: number | null;
  tag?: string | null;
}

export interface DnsConflictRecord {
  type: string;
  name: string;
  foundValue: string;
}

export interface DomainDnsStatus {
  dnsStatus: DnsActivationStatus;
  dnsRecords: GeneratedDnsRecord[];
  dnsConflicts: DnsConflictRecord[];
  dnsZoneFile?: string | null;
  dnsVerificationStartedAt?: string | null;
  dnsVerifiedAt?: string | null;
  activatedAt?: string | null;
}

export interface DnsRecordCheckResult {
  type: string;
  name: string;
  purpose: string;
  expectedValue: string;
  found: boolean;
}

export interface DnsLiveCheckResult {
  allFound: boolean;
  checkedAt: string;
  results: DnsRecordCheckResult[];
}

export type DnsProviderName = 'godaddy' | 'hostinger' | 'cloudflare';

export interface TenantDnsCredentialSummary {
  provider: DnsProviderName;
  verified: boolean;
  verifiedProviderDomain: string | null;
  connectedAt: string | null;
  lastUsedAt: string | null;
}

export interface DomainItem {
  id: string;
  domainName: string;
  status: string;
  dnsStatus?: DnsActivationStatus;
  mailboxLimit: number;
  employeeCount: number;
  planId?: string | null;
  planName?: string | null;
  mailboxCount: number;
  isPrimary: boolean;
  createdAt?: string;
  // True only for the shared platform domain (dhkmail.com) — no DNS/provider setup applies to it.
  isSharedDomain?: boolean;
}

export type PlanBillingMode = 'fixed' | 'metered';

export interface Plan {
  id: string;
  name: string;
  badge?: string | null;
  description?: string | null;
  seatCount: number;
  displayOrder: number;
  isActive: boolean;
  isDefault: boolean;
  billingMode: PlanBillingMode;
  monthlyPriceInPaise: number;
  storageQuotaGb?: number | null;
  apps?: string[];
  features?: string[];
}

export type DomainSubscriptionStatus =
  | 'incomplete'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'grace'
  | 'suspended'
  | 'canceled';

export interface DomainSubscription {
  status: DomainSubscriptionStatus;
  planId: string;
  currentPeriodEnd?: string | null;
  trialEnd?: string | null;
  gracePeriodEndsAt?: string | null;
  cancelAtPeriodEnd: boolean;
  pendingDowngradePlanId?: string | null;
}

export interface DomainBillingStatus {
  domainId: string;
  domainName: string;
  subscription: DomainSubscription | null;
}

// Combined-billing model: every domain a tenant has shares one Stripe
// subscription, so this is a tenant-wide summary (not per-domain).
export interface TenantBillingSummary {
  hasSubscription: boolean;
  status: DomainSubscriptionStatus | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  domains: Array<{ domainId: string; domainName: string; planName: string | null; seatCount: number | null }>;
}

export interface InvoiceItem {
  id: string;
  status: string | null;
  amountPaid: number;
  currency: string;
  createdAt: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

export interface TenantSummary {
  id: string;
  name: string;
  mailboxLimit: number;
  status: 'active' | 'suspended' | 'approved_pending_setup' | 'pending_deletion';
  createdAt: string;
  updatedAt: string;
  domain: {
    id: string;
    domainName: string;
    stalwartDomainId?: string | null;
    status: string;
  } | null;
  domains?: DomainItem[];
  mailboxCount: number;
  adminCount: number;
  availableMailboxes?: number;
}

export interface MailboxItem {
  id: string;
  tenantId: string;
  domainId: string;
  localPart: string;
  address: string;
  stalwartAccountId: string | null;
  status: 'provisioning' | 'active' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface AuditItem {
  id: string;
  actor_id: string | null;
  actor_role: string;
  tenant_id: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  metadata: any;
  success: boolean;
  timestamp: string;
}

export interface SystemMetrics {
  status: string;
  timestamp: string;
  stalwart: {
    status: string;
    edition?: string;
    locale?: string;
    permissionCount?: number;
    error?: string;
  };
  metrics: {
    tenants: { total: number; active: number; suspended: number };
    domains: { total: number };
    mailboxes: { total: number; active: number; provisioning: number; failed: number };
  };
}

export interface SessionItem {
  sessionId: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  browser: string;
  os: string;
  ipAddress: string;
  location?: string;
  countryCode?: string;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface SecuritySettings {
  email: string;
  recoveryEmail: string | null;
  twoFactorEnabled: boolean;
  twoFactorMethod: 'totp' | 'email' | null;
  hasTotpConfigured: boolean;
  remainingBackupCodes?: number;
}

export interface MailboxStorageItem {
  id: string;
  address: string;
  localPart: string;
  domainId: string;
  domainName: string;
  storageBytes: number;
  storageFormatted: string;
  percentage: number;
  status: string;
  createdAt: string;
}

export interface TenantStorageSummary {
  totalStorageBytes: number;
  totalStorageFormatted: string;
  mailboxCount: number;
  mailboxesWithData: number;
}

export interface TenantStorageResponse {
  summary: TenantStorageSummary;
  mailboxes: MailboxStorageItem[];
}

export interface BlockedIpItem {
  id: string;
  address: string;
  reason?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
}

export interface AllowedIpItem {
  id: string;
  address: string;
  reason?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
}

export interface IpCheckResult {
  ip: string;
  isBlocked: boolean;
  blockedEntry: BlockedIpItem | null;
  isAllowed: boolean;
  allowedEntry: AllowedIpItem | null;
}


// ---- Organisation deletion (7-day suspension → name → OTPs → permanent delete) ----
export type OrganisationDeletionStage =
  | 'requested'
  | 'name_confirmed'
  | 'otp_initiated'
  | 'final_otp_sent'
  | 'completed'
  | 'cancelled';

export type OrganisationDeletionNextAction =
  | 'confirm_name'
  | 'initiate_otp'
  | 'generate_final_otp'
  | 'verify_final_otp'
  | null;

export interface OrganisationDeletionView {
  id: string;
  tenantId: string;
  organisationName: string;
  stage: OrganisationDeletionStage;
  path: 'standard' | 'forced';
  initiatedAt: string;
  /** null until the organisation name is confirmed (that is what suspends it). */
  suspensionEndsAt: string | null;
  nameConfirmedAt: string | null;
  otpInitiatedAt: string | null;
  finalLockEndsAt: string | null;
  otpVerifiedAt: string | null;
  otpVerification: 'not_started' | 'pending' | 'verified' | 'failed';
  finalOtpExpiresAt: string | null;
  completedAt: string | null;
  nextAction: OrganisationDeletionNextAction;
  /** null = the next step is available right now. */
  nextActionAvailableAt: string | null;
}

export interface OrganisationDeletionTimings {
  suspensionDays: number;
  otpWaitHours: number;
  finalOtpMinutes: number;
}

export interface OrganisationDeletionState {
  deletion: OrganisationDeletionView | null;
  timings: OrganisationDeletionTimings;
}
