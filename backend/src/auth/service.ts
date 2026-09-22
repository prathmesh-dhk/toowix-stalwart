import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { config } from '../config';
import { AdminUserModel, IAdminUser } from '../db/models/AdminUser';
import { AuditLogModel } from '../db/models/AuditLog';
import {
  AdminRole,
  AdminUserContext,
  OidcAuthTokenPayload,
  TwoFactorPendingPayload,
} from './types';
import { sessionService } from '../services/session.service';
import { emailService } from '../services/email.service';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function generateOidcToken(
  user: AdminUserContext,
  sessionId?: string,
  rememberMe: boolean = false
): string {
  const payload: OidcAuthTokenPayload = {
    sub: user.id,
    email: user.email,
    roles: [user.role],
    tenant_id: user.tenantId,
    two_factor_verified: user.twoFactorEnabled,
    ...(sessionId ? { sid: sessionId } : {}),
    iss: 'toowix-auth',
    aud: 'toowix-api',
  };
  const expiresIn = rememberMe ? '30d' : '8h';
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

export function generate2FaPendingToken(user: AdminUserContext): string {
  const payload: TwoFactorPendingPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    tenant_id: user.tenantId,
    stage: '2FA_PENDING',
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '5m' });
}

export function verifyOidcToken(token: string): OidcAuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      issuer: 'toowix-auth',
      audience: 'toowix-api',
    }) as OidcAuthTokenPayload;
    return decoded;
  } catch {
    return null;
  }
}

export function verify2FaPendingToken(token: string): TwoFactorPendingPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as TwoFactorPendingPayload;
    if (decoded.stage !== '2FA_PENDING') return null;
    return decoded;
  } catch {
    return null;
  }
}

export function generateTotpSecret(email: string): { secret: string; otpauthUrl: string } {
  const secret = generateSecret();
  const otpauthUrl = generateURI({
    issuer: 'Toowix Mail Platform',
    label: email,
    secret,
  });
  return { secret, otpauthUrl };
}

export async function generateTotpQrCode(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    const result = verifySync({ token: code.trim(), secret, epochTolerance: 30 });
    return result?.valid === true;
  } catch {
    return false;
  }
}

export function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const [name, domain] = parts;
  if (name.length <= 2) {
    return `${name[0]}***@${domain}`;
  }
  return `${name[0]}***${name[name.length - 1]}@${domain}`;
}

export type PortalLoginResult =
  | { success: true; requires2FA: false; token: string; user: AdminUserContext }
  | {
      success: true;
      requires2FA: true;
      tempToken: string;
      user: AdminUserContext;
      defaultMethod?: 'totp' | 'email';
      hasRecoveryEmail?: boolean;
      maskedRecoveryEmail?: string | null;
      maskedEmail?: string | null;
      hasBackupCodes?: boolean;
      remainingBackupCodes?: number;
      isRecoveryEmail?: boolean;
      hasEmail2Fa?: boolean;
    }
  | { success: false; error: string; statusCode: number };

export interface GeneratedBackupCodes {
  plainCodes: string[];
  hashedCodes: Array<{ codeHash: string; used: boolean; usedAt: Date | null }>;
}

export function generateBackupCodes(count: number = 10): GeneratedBackupCodes {
  const plainCodes: string[] = [];
  const hashedCodes: Array<{ codeHash: string; used: boolean; usedAt: Date | null }> = [];

  for (let i = 0; i < count; i++) {
    const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const code = `${part1}-${part2}`;
    plainCodes.push(code);

    const normalized = code.replace(/[-\s]/g, '').toUpperCase();
    const codeHash = hashSecurityAnswer(normalized);
    hashedCodes.push({
      codeHash,
      used: false,
      usedAt: null,
    });
  }

  return { plainCodes, hashedCodes };
}

export async function authenticatePortalUser(
  portalType: AdminRole,
  email: string,
  password: string,
  clientIp: string = 'unknown',
  totpCode?: string,
  userAgent: string = '',
  rememberMe: boolean = false
): Promise<PortalLoginResult> {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await AdminUserModel.findOne({ email: normalizedEmail });

  if (!user) {
    await AuditLogModel.create({
      actorRole: 'ANONYMOUS',
      actorEmail: normalizedEmail,
      actorIp: clientIp,
      action: 'AUTH_LOGIN_FAILED',
      resource: 'ADMIN_USER',
      status: 'FAILED',
      metadata: { reason: 'user_not_found', portal: portalType },
      timestamp: new Date(),
    });
    return { success: false, error: 'Invalid email or password', statusCode: 401 };
  }

  // Strict Backend-Authoritative Portal Gating. The tenant-admin portal accepts both
  // TENANT_ADMIN and TENANT_MODERATOR — same portal/login/2FA, different in-app privileges,
  // enforced by route middleware, not at login.
  const allowedRoles: AdminRole[] = portalType === 'TENANT_ADMIN' ? ['TENANT_ADMIN', 'TENANT_MODERATOR'] : [portalType];
  if (!allowedRoles.includes(user.role)) {
    await AuditLogModel.create({
      actorId: user._id,
      actorRole: user.role,
      actorEmail: normalizedEmail,
      actorIp: clientIp,
      tenantId: user.tenantId,
      action: 'AUTH_LOGIN_REJECTED_WRONG_PORTAL',
      resource: 'ADMIN_USER',
      resourceId: user._id.toString(),
      status: 'FAILED',
      metadata: { userRole: user.role, attemptedPortal: portalType },
      timestamp: new Date(),
    });
    return {
      success: false,
      error: `Access Denied: This account is not authorized for the ${portalType === 'SUPER_ADMIN' ? 'Super Admin' : 'Tenant Admin'} portal.`,
      statusCode: 403,
    };
  }

  // Account status check
  if (user.status !== 'active') {
    await AuditLogModel.create({
      actorId: user._id,
      actorRole: user.role,
      actorEmail: normalizedEmail,
      actorIp: clientIp,
      tenantId: user.tenantId,
      action: 'AUTH_LOGIN_FAILED',
      resource: 'ADMIN_USER',
      resourceId: user._id.toString(),
      status: 'FAILED',
      metadata: { reason: 'account_disabled' },
      timestamp: new Date(),
    });
    return { success: false, error: 'Account is disabled. Contact your administrator.', statusCode: 403 };
  }

  const isValidPassword = await verifyPassword(user.passwordHash, password);
  if (!isValidPassword) {
    await AuditLogModel.create({
      actorId: user._id,
      actorRole: user.role,
      actorEmail: normalizedEmail,
      actorIp: clientIp,
      tenantId: user.tenantId,
      action: 'AUTH_LOGIN_FAILED',
      resource: 'ADMIN_USER',
      resourceId: user._id.toString(),
      status: 'FAILED',
      metadata: { reason: 'invalid_credentials' },
      timestamp: new Date(),
    });
    return { success: false, error: 'Invalid email or password', statusCode: 401 };
  }

  const userContext: AdminUserContext = {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    tenantId: user.tenantId ? user.tenantId.toString() : null,
    twoFactorEnabled: user.twoFactorEnabled,
  };

  // If 2FA is enabled
  if (user.twoFactorEnabled) {
    // If totpCode was provided upfront with credentials
    if (totpCode && totpCode.trim().length === 6) {
      const is2FaValid = verifyTotpCode(user.twoFactorSecret || '', totpCode.trim());
      if (!is2FaValid) {
        await AuditLogModel.create({
          actorId: user._id,
          actorRole: user.role,
          actorEmail: normalizedEmail,
          actorIp: clientIp,
          tenantId: user.tenantId,
          action: 'AUTH_2FA_FAILED',
          resource: 'ADMIN_USER',
          resourceId: user._id.toString(),
          status: 'FAILED',
          metadata: { reason: 'invalid_totp_code', portal: portalType },
          timestamp: new Date(),
        });
        return { success: false, error: 'Invalid 6-digit 2FA verification code. Please try again.', statusCode: 401 };
      }

      // Valid 2FA provided upfront -> issue OIDC token and session
      const session = await sessionService.createSession(userContext.id, userAgent, clientIp, rememberMe);
      const token = generateOidcToken(userContext, session.sessionId, rememberMe);
      await AuditLogModel.create({
        actorId: userContext.id,
        actorRole: userContext.role,
        actorEmail: userContext.email,
        actorIp: clientIp,
        tenantId: user.tenantId,
        action: 'AUTH_LOGIN_SUCCESS',
        resource: 'ADMIN_USER',
        resourceId: userContext.id,
        status: 'SUCCESS',
        metadata: { portal: portalType, method: 'credentials_with_2fa' },
        timestamp: new Date(),
      });
      return { success: true, requires2FA: false, token, user: userContext };
    }

    // No 2FA code provided yet -> issue short-lived temp token
    const tempToken = generate2FaPendingToken(userContext);
    const defaultMethod = user.twoFactorMethod || 'totp';

    // Note: Do not auto-send OTP here during credentials check.
    // OTP is sent strictly when the user clicks the "Continue" button on the 2FA selection screen (hitting /api/auth/2fa/send-otp).


    const hasDistinctRecovery = !!(user.recoveryEmail && user.recoveryEmail.trim().toLowerCase() !== user.email.trim().toLowerCase());
    const destinationEmail = (user.twoFactorMethod === 'email' || !hasDistinctRecovery) ? user.email : (user.recoveryEmail || user.email);
    const isRecoveryEmail = hasDistinctRecovery && user.twoFactorMethod !== 'email';

    const remainingBackupCodes = user.backupCodes ? user.backupCodes.filter((c: any) => !c.used).length : 0;

    return {
      success: true,
      requires2FA: true,
      tempToken,
      hasRecoveryEmail: hasDistinctRecovery,
      maskedRecoveryEmail: (hasDistinctRecovery && user.recoveryEmail) ? maskEmail(user.recoveryEmail) : null,
      defaultMethod,
      hasEmail2Fa: true,
      maskedEmail: maskEmail(destinationEmail),
      isRecoveryEmail,
      hasBackupCodes: remainingBackupCodes > 0,
      remainingBackupCodes,
      user: userContext,
    };
  }

  // If 2FA is not yet configured, issue OIDC session token and session
  const session = await sessionService.createSession(userContext.id, userAgent, clientIp, rememberMe);
  const token = generateOidcToken(userContext, session.sessionId, rememberMe);

  await AuditLogModel.create({
    actorId: userContext.id,
    actorRole: userContext.role,
    actorEmail: userContext.email,
    actorIp: clientIp,
    tenantId: user.tenantId,
    action: 'AUTH_LOGIN_SUCCESS',
    resource: 'ADMIN_USER',
    resourceId: userContext.id,
    status: 'SUCCESS',
    metadata: { portal: portalType },
    timestamp: new Date(),
  });

  return { success: true, requires2FA: false, token, user: userContext };
}

export async function verifyAndComplete2FaLogin(
  tempToken: string,
  code: string,
  clientIp?: string,
  method: 'totp' | 'email' | 'backup_code' = 'totp',
  userAgent?: string,
  rememberMe: boolean = false
): Promise<{ success: true; token: string; user: AdminUserContext } | { success: false; error: string; statusCode: number }> {
  const pendingPayload = verify2FaPendingToken(tempToken);
  if (!pendingPayload) {
    return { success: false, error: '2FA session expired. Please log in again.', statusCode: 401 };
  }

  const user = await AdminUserModel.findById(pendingPayload.sub);
  if (!user) {
    return { success: false, error: 'User account not found.', statusCode: 404 };
  }

  if (method === 'backup_code') {
    if (!user.backupCodes || user.backupCodes.length === 0) {
      return { success: false, error: 'No backup codes are configured for this account.', statusCode: 400 };
    }

    const normalizedInput = code.replace(/[-\s]/g, '').toUpperCase();
    const incomingHash = hashSecurityAnswer(normalizedInput);

    const matchingCodeIndex = user.backupCodes.findIndex(
      (item) => !item.used && item.codeHash === incomingHash
    );

    if (matchingCodeIndex === -1) {
      await AuditLogModel.create({
        actorId: user._id,
        actorRole: user.role,
        actorEmail: user.email,
        actorIp: clientIp,
        tenantId: user.tenantId,
        action: 'AUTH_2FA_VERIFICATION_FAILED',
        resource: 'ADMIN_USER',
        resourceId: user._id.toString(),
        status: 'FAILED',
        metadata: { reason: 'invalid_backup_code' },
        timestamp: new Date(),
      });
      return { success: false, error: 'Invalid or previously used backup code. Please verify and try another code.', statusCode: 401 };
    }

    // Mark as used
    user.backupCodes[matchingCodeIndex].used = true;
    user.backupCodes[matchingCodeIndex].usedAt = new Date();
    await user.save();
  } else if (method === 'email') {
    if (!user.loginOtp || !user.loginOtp.codeHash || !user.loginOtp.expiresAt) {
      return { success: false, error: 'No email verification code was requested. Please click Send Code first.', statusCode: 400 };
    }

    if (new Date() > new Date(user.loginOtp.expiresAt)) {
      user.loginOtp = null;
      await user.save();
      return { success: false, error: 'The email verification code has expired. Please request a new one.', statusCode: 400 };
    }

    if (user.loginOtp.attempts >= 5) {
      user.loginOtp = null;
      await user.save();
      return { success: false, error: 'Too many invalid attempts. This verification code has been revoked. Please request a new code.', statusCode: 429 };
    }

    const incomingHash = hashSecurityAnswer(code.trim());
    const isCodeMatch = crypto.timingSafeEqual(Buffer.from(user.loginOtp.codeHash), Buffer.from(incomingHash));

    if (!isCodeMatch) {
      user.loginOtp.attempts += 1;
      await user.save();
      await AuditLogModel.create({
        actorId: user._id,
        actorRole: user.role,
        actorEmail: user.email,
        actorIp: clientIp,
        tenantId: user.tenantId,
        action: 'AUTH_2FA_VERIFICATION_FAILED',
        resource: 'ADMIN_USER',
        resourceId: user._id.toString(),
        status: 'FAILED',
        metadata: { reason: 'invalid_email_otp', attempts: user.loginOtp.attempts },
        timestamp: new Date(),
      });
      return { success: false, error: 'Invalid verification code. Please check your email and try again.', statusCode: 401 };
    }

    // Code matched -> clear loginOtp
    user.loginOtp = null;
    await user.save();
  } else {
    // method === 'totp'
    if (!user.twoFactorSecret) {
      return { success: false, error: 'Authenticator app is not configured on this account. Try email verification.', statusCode: 400 };
    }

    const isCodeValid = verifyTotpCode(user.twoFactorSecret, code.trim());
    if (!isCodeValid) {
      await AuditLogModel.create({
        actorId: user._id,
        actorRole: user.role,
        actorEmail: user.email,
        actorIp: clientIp,
        tenantId: user.tenantId,
        action: 'AUTH_2FA_VERIFICATION_FAILED',
        resource: 'ADMIN_USER',
        resourceId: user._id.toString(),
        status: 'FAILED',
        metadata: { reason: 'invalid_totp_code' },
        timestamp: new Date(),
      });
      return { success: false, error: 'Invalid 6-digit authenticator code. Please check your app and try again.', statusCode: 401 };
    }
  }

  const userContext: AdminUserContext = {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    tenantId: user.tenantId ? user.tenantId.toString() : null,
    twoFactorEnabled: user.twoFactorEnabled,
  };

  const session = await sessionService.createSession(userContext.id, userAgent, clientIp, rememberMe);
  const token = generateOidcToken(userContext, session.sessionId, rememberMe);

  await AuditLogModel.create({
    actorId: userContext.id,
    actorRole: userContext.role,
    actorEmail: userContext.email,
    actorIp: clientIp,
    tenantId: user.tenantId,
    action: 'AUTH_2FA_LOGIN_SUCCESS',
    resource: 'ADMIN_USER',
    resourceId: userContext.id,
    status: 'SUCCESS',
    metadata: { role: user.role, method },
    timestamp: new Date(),
  });

  return { success: true, token, user: userContext };
}

export function normalizeSecurityAnswer(answer: string): string {
  return answer.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function hashSecurityAnswer(answer: string): string {
  const normalized = normalizeSecurityAnswer(answer);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function verifySecurityAnswer(storedHash: string, answer: string): boolean {
  const incomingHash = hashSecurityAnswer(answer);
  return crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(incomingHash));
}

export function generatePasswordResetToken(userId: string, email: string): string {
  const payload = {
    sub: userId,
    email,
    purpose: 'PASSWORD_RESET',
    iss: 'toowix-auth',
    aud: 'toowix-api',
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '15m' });
}

export function verifyPasswordResetToken(token: string): { userId: string; email: string } | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      issuer: 'toowix-auth',
      audience: 'toowix-api',
    }) as any;
    if (decoded.purpose !== 'PASSWORD_RESET') {
      return null;
    }
    return { userId: decoded.sub, email: decoded.email };
  } catch {
    return null;
  }
}

export function generateRecoveryEmailVerificationToken(email: string): string {
  return jwt.sign(
    { email: email.trim().toLowerCase(), purpose: 'RECOVERY_EMAIL_VERIFIED', iss: 'toowix-auth', aud: 'toowix-api' },
    config.jwtSecret,
    { expiresIn: '1h' }
  );
}

export function verifyRecoveryEmailVerificationToken(token: string): { email: string } | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      issuer: 'toowix-auth',
      audience: 'toowix-api',
    }) as any;
    if (decoded.purpose !== 'RECOVERY_EMAIL_VERIFIED') {
      return null;
    }
    return { email: decoded.email };
  } catch {
    return null;
  }
}

export function generateContactEmailVerificationToken(email: string): string {
  return jwt.sign(
    { email: email.trim().toLowerCase(), purpose: 'CONTACT_EMAIL_VERIFIED', iss: 'toowix-auth', aud: 'toowix-api' },
    config.jwtSecret,
    { expiresIn: '1h' }
  );
}

export function verifyContactEmailVerificationToken(token: string): { email: string } | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      issuer: 'toowix-auth',
      audience: 'toowix-api',
    }) as any;
    if (decoded.purpose !== 'CONTACT_EMAIL_VERIFIED') {
      return null;
    }
    return { email: decoded.email };
  } catch {
    return null;
  }
}

export function generateTotpSetupToken(secret: string): string {
  return jwt.sign(
    { secret, purpose: 'TOTP_SETUP', iss: 'toowix-auth', aud: 'toowix-api' },
    config.jwtSecret,
    { expiresIn: '1h' }
  );
}

export function verifyTotpSetupToken(token: string): { secret: string } | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      issuer: 'toowix-auth',
      audience: 'toowix-api',
    }) as any;
    if (decoded.purpose !== 'TOTP_SETUP') {
      return null;
    }
    return { secret: decoded.secret };
  } catch {
    return null;
  }
}


