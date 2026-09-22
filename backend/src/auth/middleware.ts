import { Request, Response, NextFunction } from 'express';
import { verifyOidcToken } from './service';
import { AdminUserContext } from './types';
import { sessionService } from '../services/session.service';
import { checkAndIncrementRateLimit, clearRateLimitKey, resetAllRateLimits } from '../utils/rate-limit';
import { AdminUserModel } from '../db/models/AdminUser';

// Brute-force login rate limiting — backed by MongoDB (see utils/rate-limit.ts)
// so attempt counts survive a backend restart/redeploy instead of resetting.
function loginRateLimitKey(ip: string, email: string): string {
  return `login:${ip}:${email.toLowerCase().trim()}`;
}

export function loginRateLimiter(windowMs: number = 15 * 60 * 1000, maxAttempts: number = 5) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const email = req.body.email || '';
    const key = loginRateLimitKey(ip, email);

    try {
      const { blocked, retryAfterSeconds } = await checkAndIncrementRateLimit(key, windowMs, maxAttempts);
      if (blocked) {
        res.setHeader('Retry-After', retryAfterSeconds);
        return res.status(429).json({
          error: 'TOO_MANY_ATTEMPTS',
          message: `Too many failed attempts. Please try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`,
        });
      }
    } catch (err) {
      // Fail open on a rate-limit store outage rather than locking every admin out of login.
      console.error('[Login Rate Limiter] Store error, allowing request through:', err);
    }

    next();
  };
}

export async function clearRateLimit(ip: string, email: string): Promise<void> {
  await clearRateLimitKey(loginRateLimitKey(ip, email));
}

export async function resetRateLimitStore(): Promise<void> {
  await resetAllRateLimits('login:');
}

export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (req.cookies && req.cookies.toowix_session) {
    return req.cookies.toowix_session;
  }
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication token required' });
  }

  const payload = verifyOidcToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Invalid or expired session token' });
  }

  if (payload.sid) {
    try {
      const active = await sessionService.isSessionActive(payload.sid);
      if (!active) {
        return res.status(401).json({
          error: 'SESSION_REVOKED',
          message: 'This session has been revoked from another device or has expired.',
        });
      }
      req.sessionId = payload.sid;
    } catch (err) {
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to verify session' });
    }
  }

  req.adminUser = {
    id: payload.sub,
    email: payload.email,
    role: payload.roles[0],
    tenantId: payload.tenant_id,
    twoFactorEnabled: payload.two_factor_verified,
  };
  (req as any).user = req.adminUser;

  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.adminUser || req.adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Requires Super Admin privileges' });
    }
    next();
  });
}

export function requireTenantAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.adminUser || req.adminUser.role !== 'TENANT_ADMIN' || !req.adminUser.tenantId) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Requires Tenant Admin privileges' });
    }
    next();
  });
}

/**
 * Populates req.adminUser.scopedDomainIds for a TENANT_MODERATOR actor (one small DB read — the
 * JWT deliberately doesn't carry scope, so a Tenant Admin revoking a domain takes effect on this
 * moderator's very next request, not just their next login). Returns false (having already sent
 * a response) if the account can't be loaded or is disabled; true otherwise, including for every
 * non-moderator role, which this is simply a no-op for.
 */
async function loadModeratorScope(req: Request, res: Response): Promise<boolean> {
  if (!req.adminUser || req.adminUser.role !== 'TENANT_MODERATOR') return true;
  try {
    const doc = await AdminUserModel.findById(req.adminUser.id).select('scopedDomainIds status');
    if (!doc || doc.status !== 'active') {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Account is disabled' });
      return false;
    }
    req.adminUser.scopedDomainIds = doc.scopedDomainIds.map((id) => id.toString());
    return true;
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to load account scope' });
    return false;
  }
}

/**
 * Gates routes a Moderator is allowed to reach at all (today: mailbox management, and reading
 * their own tenant/domain summary) — same tenant-scoped authentication as requireTenantAdmin, but
 * also accepts TENANT_MODERATOR. Domain-level restriction within those routes is a SEPARATE check
 * (isDomainInScope below), since "may use this route" and "may touch this specific domain" are
 * different questions.
 */
export async function requireTenantAdminOrModerator(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, async () => {
    if (!req.adminUser || !req.adminUser.tenantId || (req.adminUser.role !== 'TENANT_ADMIN' && req.adminUser.role !== 'TENANT_MODERATOR')) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Requires Tenant Admin or Moderator privileges' });
    }
    if (await loadModeratorScope(req, res)) next();
  });
}

/**
 * True if this actor may touch the given domain. Tenant Admin (and Super Admin) are unrestricted
 * within their own tenant boundary (already enforced elsewhere); a Moderator is restricted to
 * req.adminUser.scopedDomainIds, populated by requireTenantAdminOrModerator above. Default-deny:
 * an undefined/empty scopedDomainIds means no access, not unrestricted access.
 */
export function isDomainInScope(adminUser: AdminUserContext, domainId: string): boolean {
  if (adminUser.role !== 'TENANT_MODERATOR') return true;
  return !!adminUser.scopedDomainIds?.includes(domainId);
}

export function requireAnyAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.adminUser || (req.adminUser.role !== 'SUPER_ADMIN' && req.adminUser.role !== 'TENANT_ADMIN')) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Requires Admin privileges' });
    }
    next();
  });
}

/**
 * requireAnyAdmin, widened for the one router (resource-level mailbox routes) a Moderator needs
 * to reach — kept separate rather than widening requireAnyAdmin itself, since that's also used by
 * plans.routes.ts (plan-tier metadata for billing/domain-setup, neither of which a Moderator's
 * capability set includes — see mailbox.routes.ts spec).
 */
export async function requireAnyAdminOrModerator(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, async () => {
    if (
      !req.adminUser ||
      (req.adminUser.role !== 'SUPER_ADMIN' && req.adminUser.role !== 'TENANT_ADMIN' && req.adminUser.role !== 'TENANT_MODERATOR')
    ) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Requires Admin privileges' });
    }
    if (!(await loadModeratorScope(req, res))) return;
    next();
  });
}

export function enforceTenantScope(resourceTenantId: string, req: Request, res: Response, next: NextFunction) {
  if (!req.adminUser) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  // Super Admins have audited global oversight
  if (req.adminUser.role === 'SUPER_ADMIN') {
    return next();
  }

  // Tenant Admins must match resource tenantId exactly; return 404 to avoid IDOR enumeration
  if (req.adminUser.tenantId !== resourceTenantId) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' });
  }

  next();
}
