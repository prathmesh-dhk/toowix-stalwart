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
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
}

export type DnsActivationStatus = 'not_started' | 'activating' | 'active' | 'conflict' | 'activation_failed';

export interface GeneratedDnsRecord {
  type: 'MX' | 'TXT' | 'CNAME';
  name: string;
  value: string;
  priority?: number | null;
  ttl?: number;
  purpose: string;
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

export interface Plan {
  id: string;
  name: string;
  badge?: string | null;
  description?: string | null;
  seatCount: number;
  displayOrder: number;
  isActive: boolean;
  isDefault: boolean;
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
