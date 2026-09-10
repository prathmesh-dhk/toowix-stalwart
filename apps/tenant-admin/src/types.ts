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


