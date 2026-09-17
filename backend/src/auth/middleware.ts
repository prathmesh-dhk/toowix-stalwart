import { Request, Response, NextFunction } from 'express';
import { verifyOidcToken } from './service';
import { AdminUserContext } from './types';
import { sessionService } from '../services/session.service';
import { checkAndIncrementRateLimit, clearRateLimitKey, resetAllRateLimits } from '../utils/rate-limit';

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

export function requireAnyAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.adminUser || (req.adminUser.role !== 'SUPER_ADMIN' && req.adminUser.role !== 'TENANT_ADMIN')) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Requires Admin privileges' });
    }
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
