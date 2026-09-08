export type AdminRole = 'SUPER_ADMIN' | 'TENANT_ADMIN';

export interface AdminUserContext {
  id: string;
  email: string;
  role: AdminRole;
  tenantId: string | null;
  twoFactorEnabled: boolean;
}

export interface OidcAuthTokenPayload {
  sub: string;
  email: string;
  roles: AdminRole[];
  tenant_id: string | null;
  two_factor_verified: boolean;
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
    }
  }
}
