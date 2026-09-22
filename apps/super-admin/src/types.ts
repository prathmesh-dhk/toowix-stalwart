export type AdminRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'TENANT_MODERATOR';
export type UserRole = AdminRole;

export interface UserContext {
  id: string;
  email: string;
  role: AdminRole;
  tenantId?: string | null;
  twoFactorEnabled?: boolean;
}

export interface RegistrationApplication {
  _id: string;
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
  domain?: {
    id: string;
    domainName: string;
    status: string;
    dnsStatus: DnsActivationStatus;
    dnsRecords: GeneratedDnsRecord[];
    dnsZoneFile?: string | null;
    dnsConflicts?: any[];
  } | null;
  createdAt: string;
  updatedAt: string;
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

export interface TenantDomainSummary {
  id: string;
  domainName: string;
  stalwartDomainId?: string | null;
  status: string;
  isPrimary?: boolean;
  mailboxLimit?: number;
  employeeCount?: number;
  planId?: string | null;
  planName?: string | null;
  dnsStatus?: DnsActivationStatus;
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
  createdAt: string;
  updatedAt: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  mailboxLimit: number;
  status: 'active' | 'suspended' | 'approved_pending_setup';
  createdAt: string;
  updatedAt: string;
  domain: TenantDomainSummary | null;
  domains?: TenantDomainSummary[];
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

export interface SystemHealthDetails {
  status: 'operational' | 'degraded';
  timestamp: string;
  evaluationTimeMs: number;
  services: {
    mongodb: {
      status: 'healthy' | 'unhealthy';
      pingMs: number;
      error?: string;
    };
    stalwart: {
      status: 'connected' | 'degraded' | 'unreachable';
      latencyMs: number;
      edition?: string;
      locale?: string;
      queueDepth?: number;
    };
  };
  system: {
    nodeVersion: string;
    platform: string;
    uptimeSeconds: number;
    memoryUsage: {
      rssMb: number;
      heapUsedMb: number;
      heapTotalMb: number;
    };
  };
  backups: {
    total: number;
    latestBackupAt: string | null;
  };
  alerts: {
    alertsEnabled: boolean;
    hasWebhook: boolean;
    consecutiveFailures: Record<string, number>;
  };
}

export interface BackupRecordItem {
  id: string;
  filename: string;
  sizeBytes: number;
  checksumSha256: string;
  encrypted: boolean;
  storageType: 'local' | 's3';
  s3Key?: string;
  status: 'completed' | 'failed';
  documentCounts: {
    tenants: number;
    domains: number;
    mailboxes: number;
    admins: number;
    auditLogs: number;
  };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertConfig {
  webhookUrl?: string;
  alertEmail?: string;
  alertsEnabled: boolean;
  consecutiveFailureThreshold: number;
}

export interface MailLimitConfig {
  attachmentSizeMb: number;
  messageSizeMb: number;
  maxMailboxDepth: number;
  maxMailboxNameLength: number;
}

export interface IntegrityCheckResult {
  valid: boolean;
  backupId: string;
  filename: string;
  checksumVerified: boolean;
  decryptionVerified: boolean;
  timestamp: string;
  documentCounts: {
    tenants: number;
    domains: number;
    mailboxes: number;
    admins: number;
    auditLogs: number;
  };
  error?: string;
}

export interface QuotaDiscrepancy {
  tenantId: string;
  tenantName: string;
  recordedMailboxCount: number;
  actualActiveMailboxes: number;
}

export interface DriftReport {
  timestamp: string;
  synchronized: boolean;
  database?: {
    tenantsCount: number;
    domainsCount: number;
    activeMailboxesCount: number;
    suspendedMailboxesCount: number;
  };
  stalwart?: {
    domainsCount: number;
    accountsCount: number;
  };
  drift?: {
    missingInStalwartDomains: string[];
    orphanedInStalwartDomains: string[];
    missingInStalwartMailboxes: string[];
    orphanedInStalwartAccounts: string[];
    quotaDiscrepancies: QuotaDiscrepancy[];
  };
  domainDrift?: {
    missingInStalwartCount?: number;
    orphanedInStalwartCount?: number;
    missingInStalwartDomains?: string[];
    orphanedInStalwartDomains?: string[];
  };
  mailboxDrift?: {
    missingInStalwartCount?: number;
    orphanedInStalwartCount?: number;
    missingInStalwartMailboxes?: string[];
    orphanedInStalwartAccounts?: string[];
  };
  quotaDrift?: {
    inconsistentTenantCount?: number;
    inconsistentTenants?: Array<{
      tenantId: string;
      tenantName: string;
      cachedCount: number;
      actualActiveMailboxCount: number;
      driftDelta: number;
    }>;
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

export interface AnalyticsTenantRow {
  tenantId: string;
  tenantName: string;
  domainName: string;
  status: 'active' | 'suspended';
  mailboxCount: number;
  mailboxLimit: number;
  utilizationPct: number;
  storageBytes: number;
  emailsSent: number;
  emailsInbox: number;
  totalEmails: number;
  topMailboxes: { address: string; storageBytes: number; emailsSent: number }[];
}

export interface PlatformAnalytics {
  generatedAt: string;
  stalwartReachable: boolean;
  snapshot: {
    totalMailboxes: number;
    activeMailboxes: number;
    suspendedMailboxes: number;
    totalTenants: number;
    activeTenants: number;
    suspendedTenants: number;
    totalDomains: number;
    platform: {
      totalStorageBytes: number;
      avgStoragePerMailboxBytes: number;
      totalEmailsSent: number;
      totalEmailsInbox: number;
      totalEmails: number;
    };
  };
  perTenant: AnalyticsTenantRow[];
  topStorageConsumers: {
    address: string;
    tenantName: string;
    storageBytes: number;
    emailsSent: number;
  }[];
  auditSummary: {
    last30Days: {
      total: number;
      logins: number;
      mailboxEvents: number;
      tenantLifecycle: number;
      securityEvents: number;
    };
  };
}


export interface TenantFullDetails {
  tenant: {
    id: string;
    name: string;
    status: 'active' | 'suspended' | 'approved_pending_setup';
    mailboxLimit: number;
    mailboxCount: number;
    createdAt: string;
    updatedAt: string;
  };
  domains: Array<{
    id: string;
    domainName: string;
    stalwartDomainId: string | null;
    status: string;
    isPrimary?: boolean;
    mailboxLimit?: number;
    employeeCount?: number;
    dnsStatus?: DnsActivationStatus;
    planId?: string | null;
    planName?: string | null;
    createdAt: string;
  }>;
  admins: Array<{
    id: string;
    email: string;
    role: string;
    status?: string;
    twoFactorEnabled?: boolean;
    createdAt: string;
  }>;
  mailboxes: Array<{
    id: string;
    address: string;
    localPart: string;
    domainId: string | null;
    domainName: string;
    status: string;
    storageBytes: number;
    createdAt: string;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    actorEmail: string;
    actorRole: string;
    actorIp?: string;
    resource: string;
    resourceId?: string;
    status: 'success' | 'failure';
    timestamp: string;
    metadata?: any;
  }>;
  stats: {
    totalDomains: number;
    activeDomains: number;
    totalMailboxes: number;
    activeMailboxes: number;
    suspendedMailboxes: number;
    totalStorageBytes: number;
    mailboxLimit: number;
    usagePercent: number;
  };
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

export interface DeletionActorSnapshot {
  userId: string;
  name: string | null;
  email: string;
  role: 'SUPER_ADMIN' | 'TENANT_ADMIN';
  organisationId: string;
  organisationName: string;
}

export interface DeletionNetworkSnapshot {
  ip: string;
  ipVersion: 4 | 6 | null;
  location: string;
  countryCode?: string | null;
  deviceType: string;
  os: string;
  browser: string;
  browserVersion: string;
  sessionId?: string | null;
}

export interface DeletionTimelineEntry {
  stage: string;
  action: string;
  success: boolean;
  at: string;
  message?: string | null;
  /** null = the system itself (e.g. the OTP window lapsing). */
  actor: DeletionActorSnapshot | null;
  network: DeletionNetworkSnapshot | null;
}

/** One row of "Deleted Organisations" — the permanent audit record, list shape (no timeline). */
export interface DeletedOrganisationRecord {
  id: string;
  organisationId: string;
  organisationName: string;
  registrationEmail: string | null;
  domains: string[];
  organisationCreatedAt: string;
  path: 'standard' | 'forced';
  reason: string | null;
  stage: OrganisationDeletionStage;
  initiatedAt: string;
  initiatedBy: DeletionActorSnapshot;
  initiatedNetwork: DeletionNetworkSnapshot;
  completedAt: string | null;
  completedBy: DeletionActorSnapshot | null;
  completedNetwork: DeletionNetworkSnapshot | null;
  otpVerification: 'not_started' | 'pending' | 'verified' | 'failed';
  otpVerifiedAt: string | null;
  reRegistration: {
    status: 'none' | 'blocked';
    blockedAttempts: { at: string; ip: string; location: string; source: string }[];
  };
  emailRestriction: { email: string | null; normalized: string | null; blockedAt: string | null; permanent: boolean };
  timelineLength?: number;
  timeline?: DeletionTimelineEntry[];
}
