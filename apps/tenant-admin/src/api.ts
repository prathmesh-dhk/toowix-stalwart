import { UserContext, TenantSummary, DomainItem, MailboxItem, AuditItem, SystemMetrics, RegistrationApplication, SessionItem, SecuritySettings, TenantStorageResponse, DomainDnsStatus, BlockedIpItem, AllowedIpItem, IpCheckResult } from './types';

const TOKEN_KEY = 'toowix_mail_auth_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || data.error || `Request failed with status ${res.status}`);
  }

  return data as T;
}

export interface LoginResponse {
  requires2FA: boolean;
  token?: string;
  tempToken?: string;
  hasRecoveryEmail?: boolean;
  maskedRecoveryEmail?: string | null;
  defaultMethod?: 'totp' | 'email';
  hasEmail2Fa?: boolean;
  maskedEmail?: string | null;
  isRecoveryEmail?: boolean;
  hasBackupCodes?: boolean;
  remainingBackupCodes?: number;
  user: UserContext;
}

export const api = {
  check2Fa: (email: string) =>
    request<{ twoFactorEnabled: boolean }>('/api/auth/check-2fa', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  // Dedicated Portal Logins
  superAdminLogin: (email: string, password: string, totpCode?: string, rememberMe?: boolean) =>
    request<LoginResponse>('/api/auth/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, totpCode: totpCode || undefined, rememberMe }),
    }),

  tenantAdminLogin: (email: string, password: string, totpCode?: string, rememberMe?: boolean) =>
    request<LoginResponse>('/api/auth/tenant-admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, totpCode: totpCode || undefined, rememberMe }),
    }),

  // Legacy fallback
  login: (email: string, password: string, totpCode?: string, rememberMe?: boolean) =>
    request<LoginResponse>('/api/auth/tenant-admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, totpCode: totpCode || undefined, rememberMe }),
    }),

  send2FaLoginOtp: (tempToken: string) =>
    request<{ success: boolean; message: string; maskedRecoveryEmail?: string; maskedEmail?: string; isRecoveryEmail?: boolean; expiresMinutes: number }>('/api/auth/2fa/send-otp', {
      method: 'POST',
      body: JSON.stringify({ tempToken }),
    }),

  verify2Fa: (tempToken: string, code: string, rememberMe?: boolean, method: 'totp' | 'email' | 'backup_code' = 'totp') =>
    request<{ token: string; user: UserContext }>('/api/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ tempToken, code, rememberMe, method }),
    }),

  setup2Fa: () =>
    request<{ secret: string; qrCodeDataUrl: string }>('/api/auth/2fa/setup', {
      method: 'POST',
    }),

  confirm2Fa: (code: string) =>
    request<{ success: boolean; message: string; backupCodes?: string[] }>('/api/auth/2fa/confirm-setup', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  getMe: () => request<{ user: UserContext }>('/api/auth/me'),
  logout: () =>
    request<{ message: string }>('/api/auth/logout', { method: 'POST' }),

  // Forgot Password / Account Recovery
  getDefaultForgotPasswordAccount: (portal: 'tenant' | 'admin' = 'tenant') =>
    request<{ success: boolean; email: string; maskedEmail: string }>(
      `/api/auth/forgot-password/default-account?portal=${portal}`
    ),

  initiateForgotPassword: (email: string) =>
    request<{
      email: string;
      hasCurrentEmail?: boolean;
      maskedCurrentEmail?: string;
      hasRecoveryEmail: boolean;
      maskedRecoveryEmail: string | null;
      hasTotp?: boolean;
      hasSecurityQuestions: boolean;
      securityQuestions: string[];
      hasBackupCodes?: boolean;
    }>('/api/auth/forgot-password/initiate', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  sendForgotPasswordOtp: (email: string, target: 'current' | 'recovery' = 'recovery') =>
    request<{ success: boolean; message: string; target?: string; maskedEmail?: string }>('/api/auth/forgot-password/send-otp', {
      method: 'POST',
      body: JSON.stringify({ email, target }),
    }),

  verifyForgotPasswordOtp: (email: string, otp: string) =>
    request<{ success: boolean; resetToken: string; message: string }>('/api/auth/forgot-password/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    }),

  verifyForgotPasswordTotp: (email: string, code: string) =>
    request<{ success: boolean; resetToken: string; message: string }>('/api/auth/forgot-password/verify-totp', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),

  verifyForgotPasswordBackupCode: (email: string, code: string) =>
    request<{ success: boolean; resetToken: string; message: string }>('/api/auth/forgot-password/verify-backup-code', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),

  verifyForgotPasswordQuestions: (email: string, answers: Array<{ question: string; answer: string }>) =>
    request<{ success: boolean; resetToken: string; message: string }>('/api/auth/forgot-password/verify-questions', {
      method: 'POST',
      body: JSON.stringify({ email, answers }),
    }),

  resetForgotPassword: (resetToken: string, newPassword: string) =>
    request<{ success: boolean; message: string }>('/api/auth/forgot-password/reset', {
      method: 'POST',
      body: JSON.stringify({ resetToken, newPassword }),
    }),

  resetPassword: (email: string, resetToken: string, newPassword: string) =>
    request<{ success: boolean; message: string }>('/api/auth/forgot-password/reset', {
      method: 'POST',
      body: JSON.stringify({ email, resetToken, newPassword }),
    }),


  // Platform Admin - Tenants
  listTenants: () => request<{ tenants: TenantSummary[] }>('/api/platform/tenants'),
  createTenant: (body: { name: string; domain: string; mailboxLimit?: number }) =>
    request<TenantSummary>('/api/platform/tenants', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateTenant: (id: string, body: { name: string }) =>
    request<TenantSummary>(`/api/platform/tenants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  suspendTenant: (id: string) =>
    request<TenantSummary>(`/api/platform/tenants/${id}/suspend`, { method: 'POST' }),
  reactivateTenant: (id: string) =>
    request<TenantSummary>(`/api/platform/tenants/${id}/reactivate`, { method: 'POST' }),
  updateMailboxLimit: (id: string, mailboxLimit: number) =>
    request<TenantSummary>(`/api/platform/tenants/${id}/mailbox-limit`, {
      method: 'PATCH',
      body: JSON.stringify({ mailboxLimit }),
    }),
  deleteTenant: (id: string) =>
    request<{ message: string }>(`/api/platform/tenants/${id}`, { method: 'DELETE' }),

  // Platform Admin - Tenant Admins
  listTenantAdmins: (tenantId: string) =>
    request<{ admins: any[] }>(`/api/platform/tenants/${tenantId}/admins`),
  createTenantAdmin: (tenantId: string, body: { email: string; password: string }) =>
    request<any>(`/api/platform/tenants/${tenantId}/admins`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resetTenantAdminPassword: (tenantId: string, adminId: string, newPassword: string) =>
    request<{ message: string }>(`/api/platform/tenants/${tenantId}/admins/${adminId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),

  // Tenant Admin - Self View & Multi-Domain
  getTenantMe: () => request<{ tenant: TenantSummary }>('/api/tenants/me'),
  listTenantDomains: () => request<{ domains: DomainItem[] }>('/api/tenants/me/domains'),
  createTenantDomain: (body: { domainName: string; employeeTier: number }) =>
    // Domain is created unprovisioned (dnsStatus: 'not_started'). Stalwart/DNS
    // provisioning only happens when a Super Admin clicks "Activate Domain".
    request<{ success: boolean; domain: DomainItem }>('/api/tenants/me/domains', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  connectDnsProviderCredential: (
    domainId: string,
    credential: { provider: 'godaddy'; apiKey: string; apiSecret: string } | { provider: 'hostinger'; token: string }
  ) =>
    request<{ success: boolean; verifiedProviderDomain: string; connectedAt: string }>(
      `/api/tenants/me/domains/${domainId}/dns-provider-credential`,
      {
        method: 'POST',
        body: JSON.stringify(credential),
      }
    ),

  getDomainDnsStatus: (domainId: string) =>
    request<DomainDnsStatus>(`/api/tenants/me/domains/${domainId}/dns-status`),

  // Mailboxes (Domain Scoped)
  listMyMailboxes: (domainId?: string) => {
    const q = domainId ? `?domainId=${encodeURIComponent(domainId)}` : '';
    return request<{ mailboxes: MailboxItem[] }>(`/api/tenants/me/mailboxes${q}`);
  },
  createMailbox: (body: { localPart: string; password: string; domainId?: string }) =>
    request<MailboxItem>('/api/tenants/me/mailboxes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resetMailboxPassword: (mailboxId: string, newPassword: string) =>
    request<{ message: string }>(`/api/mailboxes/${mailboxId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),
  suspendMailbox: (mailboxId: string) =>
    request<{ message: string; mailbox: MailboxItem }>(`/api/mailboxes/${mailboxId}/suspend`, { method: 'POST' }),
  reactivateMailbox: (mailboxId: string) =>
    request<{ message: string; mailbox: MailboxItem }>(`/api/mailboxes/${mailboxId}/reactivate`, { method: 'POST' }),
  deleteMailbox: (mailboxId: string) =>
    request<{ message: string }>(`/api/mailboxes/${mailboxId}`, { method: 'DELETE' }),
  getStorageUsage: (domainId?: string) => {
    const q = domainId ? `?domainId=${encodeURIComponent(domainId)}` : '';
    return request<TenantStorageResponse>(`/api/tenants/me/storage${q}`);
  },

  // Audit Logs & System Status
  getAuditLogs: (params?: { limit?: number; offset?: number; tenantId?: string; action?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    if (params?.tenantId) q.set('tenantId', params.tenantId);
    if (params?.action) q.set('action', params.action);
    return request<{ logs: AuditItem[]; limit: number; offset: number }>(`/api/audit-logs?${q.toString()}`);
  },
  getSystemStatus: () => request<SystemMetrics>('/api/system/status'),

  // Phase 3: Public Self-Service Registration & Security
  publicSendRecoveryEmailOtp: (email: string) =>
    request<{ success: boolean; message: string; expiresMinutes: number }>('/api/public/recovery-email/send-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  publicVerifyRecoveryEmailOtp: (email: string, code: string) =>
    request<{ success: boolean; message: string; verificationToken: string }>('/api/public/recovery-email/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),

  publicSendContactEmailOtp: (email: string) =>
    request<{ success: boolean; message: string; expiresMinutes: number }>('/api/public/contact-email/send-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  publicVerifyContactEmailOtp: (email: string, code: string) =>
    request<{ success: boolean; message: string; verificationToken: string }>('/api/public/contact-email/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),

  publicRegister: (body: {
    email: string;
    emailVerificationToken: string;
    password: string;
    securityQuestions: Array<{ question: string; answer: string }>;
  }) =>
    request<{
      success: boolean;
      message: string;
      user: {
        id: string;
        email: string;
      };
    }>('/api/public/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  publicSetupTotp: (label?: string) =>
    request<{ success: boolean; secret: string; qrCodeDataUrl: string }>('/api/public/totp/setup', {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),

  publicVerifyTotp: (secret: string, code: string) =>
    request<{ success: boolean; message: string; totpSetupToken: string }>('/api/public/totp/verify', {
      method: 'POST',
      body: JSON.stringify({ secret, code }),
    }),

  publicRegisterTenant: (body: {
    companyName: string;
    requestedDomain: string;
    applicantName?: string;
    firstName?: string;
    lastName?: string;
    contactEmail: string;
    phone?: string;
    notes?: string;
    employeeCount?: string;
    region?: string;
    password?: string;
    recoveryEmail?: string;
    recoveryEmailVerificationToken?: string;
    contactEmailVerificationToken?: string;
    totpSetupToken?: string;
    securityQuestions?: Array<{ question: string; answer: string }>;
  }) =>
    request<{
      success: boolean;
      message: string;
      application: {
        id: string;
        companyName: string;
        requestedDomain: string;
        status: string;
        createdAt: string;
      };
    }>('/api/public/register-tenant', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Phase 3: Super Admin Application Queue
  listApplications: (params?: { status?: string; limit?: number; skip?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.skip) q.set('skip', String(params.skip));
    return request<{
      applications: RegistrationApplication[];
      pagination: { total: number; limit: number; skip: number };
    }>(`/api/super-admin/applications?${q.toString()}`);
  },

  getApplication: (id: string) =>
    request<{ application: RegistrationApplication }>(`/api/super-admin/applications/${id}`),

  approveApplication: (id: string) =>
    request<{
      success: boolean;
      message: string;
      tenant: { id: string; name: string; status: string; domain: string; contactEmail: string };
    }>(`/api/super-admin/applications/${id}/approve`, {
      method: 'POST',
    }),

  rejectApplication: (id: string, reason: string) =>
    request<{
      success: boolean;
      message: string;
      application: { id: string; status: string; rejectionReason: string };
    }>(`/api/super-admin/applications/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // Phase 4: Tenant Activation
  validateActivationToken: (token: string) =>
    request<{
      valid: boolean;
      tenant: { id: string; name: string; status: string };
      domain: string;
      contactEmail: string;
      totpSecret: string;
      qrCodeDataUrl: string;
      hasRegistrationPassword?: boolean;
    }>(`/api/public/activate-token/${token}`),

  verifyActivationPassword: (body: { token: string; password: string }) =>
    request<{ valid: boolean; message?: string }>('/api/public/verify-activation-password', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  completeActivation: (body: {
    token: string;
    email: string;
    password: string;
    totpSecret: string;
    totpCode: string;
  }) =>
    request<{
      success: boolean;
      message: string;
      token: string;
      user: UserContext;
    }>('/api/public/activate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Active Device & Session Management
  listSessions: () =>
    request<{ sessions: SessionItem[] }>('/api/auth/sessions'),

  revokeSession: (sessionId: string) =>
    request<{ success: boolean; message: string }>(`/api/auth/sessions/${sessionId}`, {
      method: 'DELETE',
    }),

  revokeOtherSessions: () =>
    request<{ success: boolean; message: string; revokedCount: number }>('/api/auth/sessions/revoke-others', {
      method: 'POST',
    }),

  // Account Security & Recovery Email Settings
  getSecuritySettings: () =>
    request<SecuritySettings>('/api/auth/security/settings'),

  sendRecoveryEmailOtp: (email: string) =>
    request<{ success: boolean; message: string; expiresMinutes: number }>('/api/auth/security/recovery-email/send-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  verifyRecoveryEmailOtp: (code: string) =>
    request<{ success: boolean; message: string; recoveryEmail: string }>('/api/auth/security/recovery-email/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  removeRecoveryEmail: () =>
    request<{ success: boolean; message: string }>('/api/auth/security/recovery-email', {
      method: 'DELETE',
    }),

  update2FaMode: (mode: 'totp' | 'email' | 'disabled') =>
    request<{
      success: boolean;
      message: string;
      twoFactorEnabled: boolean;
      twoFactorMethod: 'totp' | 'email' | null;
      backupCodes?: string[];
      remainingBackupCodes?: number;
    }>('/api/auth/security/2fa/mode', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),

  setupTotp2Fa: () =>
    request<{ secret: string; qrCodeDataUrl: string }>('/api/auth/2fa/setup', {
      method: 'POST',
    }),

  confirmTotp2Fa: (code: string) =>
    request<{ success: boolean; message: string; backupCodes?: string[] }>('/api/auth/2fa/confirm-setup', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  regenerateBackupCodes: () =>
    request<{
      success: boolean;
      message: string;
      backupCodes: string[];
      remainingBackupCodes: number;
    }>('/api/auth/security/2fa/backup-codes/regenerate', {
      method: 'POST',
    }),

  // ==========================================
  // SECURITY FIREWALL / IP MANAGEMENT
  // ==========================================

  checkIpStatus: (ip: string) =>
    request<IpCheckResult>(`/api/tenants/me/security/check-ip?ip=${encodeURIComponent(ip)}`),

  getBlockedIps: () =>
    request<{ list: BlockedIpItem[] }>('/api/tenants/me/security/blocked-ips'),

  unblockIp: (params: { id?: string; address?: string }) =>
    request<{ success: boolean; unblockedCount: number; message: string }>(
      '/api/tenants/me/security/blocked-ips/unblock',
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    ),

  blockIp: (params: { address: string; reason?: string }) =>
    request<{ success: boolean; message: string; item: BlockedIpItem }>(
      '/api/tenants/me/security/blocked-ips',
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    ),

  getAllowedIps: () =>
    request<{ list: AllowedIpItem[] }>('/api/tenants/me/security/allowed-ips'),

  addAllowedIp: (params: { address: string; reason?: string }) =>
    request<{ success: boolean; message: string; item: AllowedIpItem }>(
      '/api/tenants/me/security/allowed-ips',
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    ),

  removeAllowedIp: (id: string) =>
    request<{ success: boolean; message: string }>(
      `/api/tenants/me/security/allowed-ips/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    ),
};



