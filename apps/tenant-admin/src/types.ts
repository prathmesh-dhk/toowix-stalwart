export type AdminRole = 'SUPER_ADMIN' | 'TENANT_ADMIN';
export type UserRole = AdminRole;

export interface UserContext {
  id: string;
  email: string;
  role: AdminRole;
  tenantId?: string | null;
  twoFactorEnabled?: boolean;
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
  status: 'active' | 'suspended' | 'approved_pending_setup';
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

export interface DomainDeletionRequestItem {
  id: string;
  domainId: string;
  domainName: string;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string | null;
  rejectionReason?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

