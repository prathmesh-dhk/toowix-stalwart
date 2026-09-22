export type AdminRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'TENANT_MODERATOR';

export interface AdminUserContext {
  id: string;
  email: string;
  role: AdminRole;
  tenantId: string | null;
  twoFactorEnabled: boolean;
  // Only meaningful for TENANT_MODERATOR: the domain IDs (within their own tenant) this account
  // may act on. Empty/undefined for every other role, which are unrestricted within their tenant.
  scopedDomainIds?: string[];
}

export interface OidcAuthTokenPayload {
  sub: string;
  email: string;
  roles: AdminRole[];
  tenant_id: string | null;
  two_factor_verified: boolean;
  sid?: string;
  iss: 'toowix-auth';
  aud: 'toowix-api';
  iat?: number;
  exp?: number;
}

export interface TwoFactorPendingPayload {
  sub: string;
  email: string;
  role: AdminRole;
  tenant_id: string | null;
  stage: '2FA_PENDING';
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      adminUser?: AdminUserContext;
      user?: AdminUserContext;
      sessionId?: string;
    }
  }
}
