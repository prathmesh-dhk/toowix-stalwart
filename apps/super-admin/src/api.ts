import {
  UserContext,
  TenantSummary,
  MailboxItem,
  AuditItem,
  SystemMetrics,
  RegistrationApplication,
  SystemHealthDetails,
  BackupRecordItem,
  AlertConfig,
  IntegrityCheckResult,
  DriftReport,
  SessionItem,
  PlatformAnalytics,
} from './types';

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
    request<{ success: boolean; message: string; maskedRecoveryEmail: string; expiresMinutes: number }>('/api/auth/2fa/send-otp', {
      method: 'POST',
      body: JSON.stringify({ tempToken }),
    }),

  verify2Fa: (tempToken: string, code: string, rememberMe?: boolean, method: 'totp' | 'email' = 'totp') =>
    request<{ token: string; user: UserContext }>('/api/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ tempToken, code, rememberMe, method }),
    }),

  setup2Fa: () =>
    request<{ secret: string; qrCodeDataUrl: string }>('/api/auth/2fa/setup', {
      method: 'POST',
    }),

  confirm2Fa: (code: string) =>
    request<{ success: boolean; message: string }>('/api/auth/2fa/confirm-setup', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  getMe: () => request<{ user: UserContext }>('/api/auth/me'),
  logout: () =>
    request<{ message: string }>('/api/auth/logout', { method: 'POST' }),

  // Forgot Password / Account Recovery
  getDefaultForgotPasswordAccount: (portal: 'tenant' | 'admin' = 'admin') =>
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

  verifyForgotPasswordQuestions: (email: string, answers: Array<{ question: string; answer: string }>) =>
    request<{ success: boolean; resetToken: string; message: string }>('/api/auth/forgot-password/verify-questions', {
      method: 'POST',
      body: JSON.stringify({ email, answers }),
    }),

  resetPassword: (email: string, resetToken: string, newPassword: string) =>
    request<{ success: boolean; message: string }>('/api/auth/forgot-password/reset', {
      method: 'POST',
      body: JSON.stringify({ email, resetToken, newPassword }),
    }),

  resetForgotPassword: (resetToken: string, newPassword: string, email?: string) =>
    request<{ success: boolean; message: string }>('/api/auth/forgot-password/reset', {
      method: 'POST',
      body: JSON.stringify({ email: email || '', resetToken, newPassword }),
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
  getMailLimits: () => request<{ attachmentSizeMb: number; messageSizeMb: number; maxMailboxDepth: number; maxMailboxNameLength: number }>('/api/system/mail-limits'),
  updateMailLimits: (payload: { attachmentSizeMb: number; messageSizeMb: number; maxMailboxDepth: number; maxMailboxNameLength: number }) =>
    request<{ success: boolean; message: string; config: { attachmentSizeMb: number; messageSizeMb: number; maxMailboxDepth: number; maxMailboxNameLength: number } }>('/api/system/mail-limits', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  activateTenant: (id: string) =>
    request<{
      success: boolean;
      message: string;
      activationLink: string;
      contactEmail?: string;
      emailSent?: boolean;
      emailError?: string;
      tenant: TenantSummary;
    }>(`/api/platform/tenants/${id}/activate`, {
      method: 'POST',
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

  // Tenant Admin - Self View
  getTenantMe: () => request<{ tenant: TenantSummary }>('/api/tenants/me'),

  // Mailboxes
  listMyMailboxes: () => request<{ mailboxes: MailboxItem[] }>('/api/tenants/me/mailboxes'),
  createMailbox: (body: { localPart: string; password: string }) =>
    request<MailboxItem>('/api/tenants/me/mailboxes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resetMailboxPassword: (mailboxId: string, newPassword: string) =>
    request<{ message: string }>(`/api/mailboxes/${mailboxId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),
  deleteMailbox: (mailboxId: string) =>
    request<{ message: string }>(`/api/mailboxes/${mailboxId}`, { method: 'DELETE' }),

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

  // Phase 3: Public Self-Service Registration
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
      activationLink?: string;
      emailSent?: boolean;
      emailError?: string;
      tenant: { id: string; name: string; status: string; domain: string; contactEmail: string };
    }>(`/api/super-admin/applications/${id}/approve`, {
      method: 'POST',
    }),

  resendActivationEmail: (tenantId: string) =>
    request<{
      success: boolean;
      message: string;
      activationLink: string;
      contactEmail: string;
      emailSent: boolean;
      emailError?: string;
    }>(`/api/platform/tenants/${tenantId}/resend-activation`, {
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

  // Phase 7: System Operations, Health, Backups & Alerts
  getDetailedSystemHealth: () => request<SystemHealthDetails>('/api/system/health'),

  getReconciliationReport: () => request<DriftReport>('/api/system/reconciliation'),

  repairQuotaDrift: () =>
    request<{ success: boolean; message: string; repaired: any[] }>('/api/system/reconciliation/sync-quota', {
      method: 'POST',
    }),

  createBackup: () =>
    request<{ success: boolean; message: string; backup: BackupRecordItem }>('/api/system/backup', {
      method: 'POST',
    }),

  listBackups: () => request<{ backups: BackupRecordItem[] }>('/api/system/backups'),

  verifyBackup: (id: string) =>
    request<IntegrityCheckResult>(`/api/system/backups/${id}/verify`, {
      method: 'POST',
    }),

  deleteBackup: (id: string) =>
    request<{ success: boolean; message: string }>(`/api/system/backups/${id}`, {
      method: 'DELETE',
    }),

  getAlertConfig: () => request<AlertConfig>('/api/system/alerts/config'),

  updateAlertConfig: (body: Partial<AlertConfig>) =>
    request<{ success: boolean; message: string; config: AlertConfig }>('/api/system/alerts/config', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  sendTestAlert: (webhookUrl?: string) =>
    request<{ success: boolean; message: string }>('/api/system/alerts/test', {
      method: 'POST',
      body: JSON.stringify({ webhookUrl }),
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
    }>(`/api/public/activate-token/${token}`),

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

  // Analytics
  getAnalytics: () =>
    request<PlatformAnalytics>('/api/system/analytics'),
};



