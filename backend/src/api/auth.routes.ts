import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import {
  authenticatePortalUser,
  verifyAndComplete2FaLogin,
  verify2FaPendingToken,
  verifyOidcToken,
  generateTotpSecret,
  generateTotpQrCode,
  verifyTotpCode,
  generateBackupCodes,
  hashPassword,
  generatePasswordResetToken,
  verifyPasswordResetToken,
  verifySecurityAnswer,
  hashSecurityAnswer,
  maskEmail,
} from '../auth/service';
import { requireAuth, loginRateLimiter, extractToken } from '../auth/middleware';
import { AdminUserModel } from '../db/models/AdminUser';
import { MailboxModel } from '../db/models/Mailbox';
import { AuditLogModel } from '../db/models/AuditLog';
import { emailService } from '../services/email.service';
import { sessionService } from '../services/session.service';
import { MailboxService } from '../services/mailbox.service';
import { stalwartClient } from '../stalwart/client';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  totpCode: z.string().optional(),
  rememberMe: z.boolean().optional(),
});

const verify2FaSchema = z.object({
  tempToken: z.string().min(1, '2FA temporary session token is required'),
  code: z.string().min(6, 'Verification code must be at least 6 characters').max(32, 'Verification code is too long'),
  rememberMe: z.boolean().optional(),
  method: z.enum(['totp', 'email', 'backup_code']).optional().default('totp'),
});

const confirm2FaSchema = z.object({
  code: z.string().length(6, 'Verification code must be exactly 6 digits'),
});

// Helper for cookie options
const getCookieOptions = (rememberMe?: boolean) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000, // 30 days if rememberMe, else 8h
});

// 0. Pre-login 2FA Detection Endpoint
authRouter.post('/check-2fa', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const user = await AdminUserModel.findOne({ email: normalizedEmail });
  return res.status(200).json({
    twoFactorEnabled: !!user?.twoFactorEnabled,
  });
});

// 1. Super Admin Dedicated Login Endpoint
authRouter.post('/super-admin/login', loginRateLimiter(), async (req: Request, res: Response) => {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { email, password, totpCode, rememberMe } = parseResult.data;
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'];

  const result = await authenticatePortalUser('SUPER_ADMIN', email, password, clientIp, totpCode, userAgent, !!rememberMe);

  if (!result.success) {
    return res.status(result.statusCode).json({ error: 'AUTH_FAILED', message: result.error });
  }

  if (result.requires2FA) {
    return res.status(200).json({
      requires2FA: true,
      tempToken: result.tempToken,
      hasRecoveryEmail: (result as any).hasRecoveryEmail || false,
      maskedRecoveryEmail: (result as any).maskedRecoveryEmail || null,
      defaultMethod: (result as any).defaultMethod || 'totp',
      hasEmail2Fa: (result as any).hasEmail2Fa ?? true,
      maskedEmail: (result as any).maskedEmail || null,
      isRecoveryEmail: (result as any).isRecoveryEmail || false,
      hasBackupCodes: (result as any).hasBackupCodes ?? false,
      remainingBackupCodes: (result as any).remainingBackupCodes ?? 0,
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
      },
    });
  }

  res.cookie('toowix_session', result.token, getCookieOptions(rememberMe));
  return res.status(200).json({
    requires2FA: false,
    token: result.token,
    user: result.user,
  });
});

// 2. Tenant Admin Dedicated Login Endpoint
authRouter.post('/tenant-admin/login', loginRateLimiter(), async (req: Request, res: Response) => {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { email, password, totpCode, rememberMe } = parseResult.data;
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'];

  const result = await authenticatePortalUser('TENANT_ADMIN', email, password, clientIp, totpCode, userAgent, !!rememberMe);

  if (!result.success) {
    return res.status(result.statusCode).json({ error: 'AUTH_FAILED', message: result.error });
  }

  if (result.requires2FA) {
    return res.status(200).json({
      requires2FA: true,
      tempToken: result.tempToken,
      hasRecoveryEmail: (result as any).hasRecoveryEmail || false,
      maskedRecoveryEmail: (result as any).maskedRecoveryEmail || null,
      defaultMethod: (result as any).defaultMethod || 'totp',
      hasEmail2Fa: (result as any).hasEmail2Fa ?? true,
      maskedEmail: (result as any).maskedEmail || null,
      isRecoveryEmail: (result as any).isRecoveryEmail || false,
      hasBackupCodes: (result as any).hasBackupCodes ?? false,
      remainingBackupCodes: (result as any).remainingBackupCodes ?? 0,
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
      },
    });
  }

  res.cookie('toowix_session', result.token, getCookieOptions(rememberMe));
  return res.status(200).json({
    requires2FA: false,
    token: result.token,
    user: result.user,
  });
});

// 2.5 Send Login 2FA Email OTP
authRouter.post('/2fa/send-otp', async (req: Request, res: Response) => {
  const schema = z.object({
    tempToken: z.string().min(1, '2FA temporary session token is required'),
  });
  const parseResult = schema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const pendingPayload = verify2FaPendingToken(parseResult.data.tempToken);
  if (!pendingPayload) {
    return res.status(401).json({ error: 'SESSION_EXPIRED', message: '2FA session expired. Please log in again.' });
  }

  const user = await AdminUserModel.findById(pendingPayload.sub);
  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User account not found' });
  }

  const hasDistinctRecovery = !!(user.recoveryEmail && user.recoveryEmail.trim().toLowerCase() !== user.email.trim().toLowerCase());
  const destinationEmail = (user.twoFactorMethod === 'email' || !hasDistinctRecovery) ? user.email : (user.recoveryEmail || user.email);
  const isRecoveryEmail = hasDistinctRecovery && user.twoFactorMethod !== 'email';
  const otpCode = crypto.randomInt(100000, 999999).toString();
  const codeHash = hashSecurityAnswer(otpCode);

  user.loginOtp = {
    codeHash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0,
  };
  await user.save();

  await emailService.sendLogin2FaOtpEmail({
    to: destinationEmail,
    recipientName: user.email,
    otpCode,
    expiresMinutes: 10,
  });

  return res.status(200).json({
    success: true,
    message: isRecoveryEmail ? 'Verification code sent to recovery email' : 'Verification code sent to email',
    maskedRecoveryEmail: maskEmail(destinationEmail),
    maskedEmail: maskEmail(destinationEmail),
    isRecoveryEmail,
    expiresMinutes: 10,
  });
});

// 3. Complete 2FA Verification
authRouter.post('/2fa/verify', async (req: Request, res: Response) => {
  const parseResult = verify2FaSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { tempToken, code, rememberMe, method } = parseResult.data;
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'];

  const result = await verifyAndComplete2FaLogin(tempToken, code, clientIp, method, userAgent, !!rememberMe);

  if (!result.success) {
    return res.status(result.statusCode).json({ error: '2FA_FAILED', message: result.error });
  }

  res.cookie('toowix_session', result.token, getCookieOptions(rememberMe));
  return res.status(200).json({
    token: result.token,
    user: result.user,
  });
});

// 4. Setup 2FA (Generates QR Code for Authenticator Apps)
authRouter.post('/2fa/setup', requireAuth, async (req: Request, res: Response) => {
  const adminUser = req.adminUser!;
  const { secret, otpauthUrl } = generateTotpSecret(adminUser.email);
  const qrCodeDataUrl = await generateTotpQrCode(otpauthUrl);

  // Temporarily store secret until verified with confirm-setup
  await AdminUserModel.findByIdAndUpdate(adminUser.id, {
    twoFactorSecret: secret,
  });

  return res.status(200).json({
    secret,
    qrCodeDataUrl,
  });
});

// 5. Confirm and Lock 2FA Setup
authRouter.post('/2fa/confirm-setup', requireAuth, async (req: Request, res: Response) => {
  const parseResult = confirm2FaSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { code } = parseResult.data;
  const adminUser = req.adminUser!;

  const dbUser = await AdminUserModel.findById(adminUser.id);
  if (!dbUser || !dbUser.twoFactorSecret) {
    return res.status(400).json({ error: 'NO_SECRET', message: 'Initiate 2FA setup first.' });
  }

  const isValid = verifyTotpCode(dbUser.twoFactorSecret, code);
  if (!isValid) {
    return res.status(400).json({ error: 'INVALID_CODE', message: 'Verification code does not match. Try again.' });
  }

  const { plainCodes, hashedCodes } = generateBackupCodes(10);
  dbUser.twoFactorEnabled = true;
  dbUser.twoFactorMethod = 'totp';
  dbUser.backupCodes = hashedCodes as any;
  await dbUser.save();

  try {
    await emailService.sendBackupCodesEmail({
      to: dbUser.email,
      recipientName: dbUser.name || dbUser.email,
      backupCodes: plainCodes,
    });
  } catch (err) {
    console.error('Failed to dispatch backup codes email on TOTP confirmation:', err);
  }

  await AuditLogModel.create({
    actorId: dbUser._id,
    actorRole: dbUser.role,
    actorEmail: dbUser.email,
    tenantId: dbUser.tenantId,
    action: 'ADMIN_2FA_ENABLED',
    resource: 'ADMIN_USER',
    resourceId: dbUser._id.toString(),
    status: 'SUCCESS',
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    message: 'Two-factor authentication successfully enabled.',
    backupCodes: plainCodes,
  });
});

// 6. Get Current Authenticated Context
authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  return res.status(200).json({ user: req.adminUser });
});

// 7. Logout
authRouter.post('/logout', async (req: Request, res: Response) => {
  res.clearCookie('toowix_session');
  const token = extractToken(req);
  if (token) {
    try {
      const payload = verifyOidcToken(token);
      if (payload && payload.sid) {
        await sessionService.revokeSession(payload.sub, payload.sid, payload.email);
      }
    } catch {
      // Best-effort cleanup
    }
  }
  return res.status(200).json({ success: true, message: 'Logged out successfully' });
});

// =========================================================================
// SESSION MANAGEMENT ENDPOINTS
// =========================================================================

// List active sessions for the authenticated user
authRouter.get('/sessions', requireAuth, async (req: Request, res: Response) => {
  try {
    const adminUser = req.adminUser!;
    const sessions = await sessionService.listUserSessions(adminUser.id, req.sessionId);
    return res.status(200).json({ sessions });
  } catch (err: any) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message || 'Failed to list sessions' });
  }
});

// Revoke a specific session
authRouter.delete('/sessions/:sessionId', requireAuth, async (req: Request, res: Response) => {
  try {
    const adminUser = req.adminUser!;
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'sessionId is required' });
    }

    const success = await sessionService.revokeSession(adminUser.id, sessionId, adminUser.email);
    if (!success) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found or already revoked' });
    }

    return res.status(200).json({ success: true, message: 'Session revoked successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message || 'Failed to revoke session' });
  }
});

// Revoke all sessions except the current one
authRouter.post('/sessions/revoke-others', requireAuth, async (req: Request, res: Response) => {
  try {
    const adminUser = req.adminUser!;
    if (!req.sessionId) {
      return res.status(400).json({
        error: 'CURRENT_SESSION_REQUIRED',
        message: 'Current session ID could not be identified from your token. Please log in again.',
      });
    }

    const revokedCount = await sessionService.revokeOtherSessions(adminUser.id, req.sessionId, adminUser.email);
    return res.status(200).json({
      success: true,
      message: `Successfully revoked ${revokedCount} other session${revokedCount === 1 ? '' : 's'}.`,
      revokedCount,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message || 'Failed to revoke other sessions' });
  }
});

// =========================================================================
// FORGOT PASSWORD / ACCOUNT RECOVERY ENDPOINTS
// =========================================================================

export function maskEmailAddress(email: string): string {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  if (local.length <= 4) return `${local.slice(0, 1)}***${local.slice(-1)}@${domain}`;
  if (local.length <= 6) return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-2)}@${domain}`;
}

const forgotPasswordInitiateSchema = z.object({
  email: z.string().email('Valid email address is required'),
});

const forgotPasswordSendOtpSchema = z.object({
  email: z.string().email('Valid email address is required'),
  target: z.enum(['current', 'recovery']).optional().default('recovery'),
});

const forgotPasswordVerifyTotpSchema = z.object({
  email: z.string().email('Valid email address is required'),
  code: z.string().regex(/^\d{6}$/, 'Authenticator code must be exactly 6 digits'),
});

const forgotPasswordVerifyOtpSchema = z.object({
  email: z.string().email('Valid email address is required'),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
});

const forgotPasswordVerifyQuestionsSchema = z.object({
  email: z.string().email('Valid email address is required'),
  answers: z
    .array(
      z.object({
        question: z.string().min(1, 'Question text is required'),
        answer: z.string().min(1, 'Answer text is required'),
      })
    )
    .length(3, 'Exactly 3 security question answers are required'),
});

const forgotPasswordVerifyBackupCodeSchema = z.object({
  email: z.string().email('Valid email address is required'),
  code: z.string().min(6, 'Backup code must be at least 6 characters').max(32, 'Backup code is too long'),
});

const forgotPasswordResetSchema = z.object({
  resetToken: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters long'),
});

// 0. Default Account Hint: Returns the current/recent active admin email for the portal
authRouter.get('/forgot-password/default-account', async (req: Request, res: Response) => {
  const portal = (req.query.portal as string) || 'tenant';
  let user = null;

  if (portal === 'admin' || portal === 'super-admin') {
    user = await AdminUserModel.findOne({ role: 'SUPER_ADMIN', status: 'active' });
  } else {
    user = await AdminUserModel.findOne({ role: 'TENANT_ADMIN', status: 'active' }).sort({ createdAt: -1 });
    if (!user) {
      user = await AdminUserModel.findOne({ status: 'active' }).sort({ createdAt: -1 });
    }
  }

  if (user) {
    return res.status(200).json({
      success: true,
      email: user.email,
      maskedEmail: maskEmailAddress(user.email),
    });
  }

  const fallbackEmail = portal === 'admin' ? 'admin@toowix.com' : 'admin@company.com';
  return res.status(200).json({
    success: true,
    email: fallbackEmail,
    maskedEmail: maskEmailAddress(fallbackEmail),
  });
});

// A. Initiate Forgot Password: check recovery options for the given email
authRouter.post('/forgot-password/initiate', async (req: Request, res: Response) => {
  const parseResult = forgotPasswordInitiateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const normalizedEmail = parseResult.data.email.trim().toLowerCase();
  const user = await AdminUserModel.findOne({ email: normalizedEmail });

  if (!user || user.status !== 'active') {
    return res.status(404).json({
      error: 'USER_NOT_FOUND',
      message: 'No active administrator account was found with this email address.',
    });
  }

  const hasCurrentEmail = true;
  const maskedCurrentEmail = maskEmailAddress(user.email);
  const hasRecoveryEmail = !!user.recoveryEmail;
  const maskedRecoveryEmail = user.recoveryEmail ? maskEmailAddress(user.recoveryEmail) : null;
  const hasTotp = !!(user.twoFactorEnabled && user.twoFactorSecret);
  const hasSecurityQuestions = !!(user.securityQuestions && user.securityQuestions.length === 3);
  const securityQuestions = user.securityQuestions ? user.securityQuestions.map((q) => q.question) : [];
  const hasBackupCodes = !!(user.backupCodes && user.backupCodes.some((b) => !b.used));

  return res.status(200).json({
    email: user.email,
    hasCurrentEmail,
    maskedCurrentEmail,
    hasRecoveryEmail,
    maskedRecoveryEmail,
    hasTotp,
    hasSecurityQuestions,
    securityQuestions,
    hasBackupCodes,
  });
});

// B. Send OTP to current or recovery email
authRouter.post('/forgot-password/send-otp', async (req: Request, res: Response) => {
  const parseResult = forgotPasswordSendOtpSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const normalizedEmail = parseResult.data.email.trim().toLowerCase();
  const target = parseResult.data.target || 'recovery';
  const user = await AdminUserModel.findOne({ email: normalizedEmail });

  if (!user || user.status !== 'active') {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' });
  }

  let destinationEmail: string;
  if (target === 'current') {
    destinationEmail = user.email;
  } else {
    if (!user.recoveryEmail) {
      return res.status(400).json({
        error: 'NO_RECOVERY_EMAIL',
        message: 'No recovery email address is configured for this account.',
      });
    }
    destinationEmail = user.recoveryEmail;
  }

  // Generate 6-digit numeric OTP
  const otpCode = crypto.randomInt(100000, 999999).toString();
  const codeHash = crypto.createHash('sha256').update(otpCode).digest('hex');

  user.passwordResetOtp = {
    codeHash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    attempts: 0,
  };
  await user.save();

  await emailService.sendPasswordResetOtpEmail({
    to: destinationEmail,
    recipientName: user.email,
    otpCode,
    expiresMinutes: 10,
  });

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  await AuditLogModel.create({
    actorRole: user.role,
    actorEmail: user.email,
    actorIp: clientIp,
    tenantId: user.tenantId,
    action: 'PASSWORD_RESET_OTP_SENT',
    resource: 'ADMIN_USER',
    resourceId: user._id.toString(),
    status: 'SUCCESS',
    metadata: { target, destinationEmail: maskEmailAddress(destinationEmail) },
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    target,
    maskedEmail: maskEmailAddress(destinationEmail),
    message: `A 6-digit verification code has been dispatched to ${maskEmailAddress(destinationEmail)}.`,
  });
});

// C. Verify OTP from recovery email
authRouter.post('/forgot-password/verify-otp', async (req: Request, res: Response) => {
  const parseResult = forgotPasswordVerifyOtpSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { email, otp } = parseResult.data;
  const normalizedEmail = email.trim().toLowerCase();
  const user = await AdminUserModel.findOne({ email: normalizedEmail });

  if (!user || user.status !== 'active') {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' });
  }

  if (!user.passwordResetOtp || !user.passwordResetOtp.codeHash) {
    return res.status(400).json({
      error: 'OTP_NOT_REQUESTED',
      message: 'No pending verification code found. Please request a new code.',
    });
  }

  if (new Date() > new Date(user.passwordResetOtp.expiresAt)) {
    user.passwordResetOtp = null;
    await user.save();
    return res.status(410).json({
      error: 'OTP_EXPIRED',
      message: 'The verification code has expired. Please request a fresh code.',
    });
  }

  if (user.passwordResetOtp.attempts >= 5) {
    user.passwordResetOtp = null;
    await user.save();
    return res.status(429).json({
      error: 'TOO_MANY_ATTEMPTS',
      message: 'Too many incorrect attempts. Please request a new verification code.',
    });
  }

  const incomingHash = crypto.createHash('sha256').update(otp.trim()).digest('hex');
  if (incomingHash !== user.passwordResetOtp.codeHash) {
    user.passwordResetOtp.attempts += 1;
    await user.save();
    return res.status(400).json({
      error: 'INVALID_OTP',
      message: 'Invalid verification code. Please check your recovery email and try again.',
    });
  }

  // OTP verified successfully: issue reset token valid for 15 minutes
  const resetToken = generatePasswordResetToken(user._id.toString(), user.email);
  const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

  user.passwordResetOtp = null;
  user.passwordResetToken = {
    tokenHash: resetTokenHash,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  };
  await user.save();

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  await AuditLogModel.create({
    actorRole: user.role,
    actorEmail: user.email,
    actorIp: clientIp,
    tenantId: user.tenantId,
    action: 'PASSWORD_RESET_OTP_VERIFIED',
    resource: 'ADMIN_USER',
    resourceId: user._id.toString(),
    status: 'SUCCESS',
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    resetToken,
    message: 'Verification code confirmed. You can now set your new password.',
  });
});

// C2. Verify TOTP from Authenticator App for Forgot Password
authRouter.post('/forgot-password/verify-totp', async (req: Request, res: Response) => {
  const parseResult = forgotPasswordVerifyTotpSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { email, code } = parseResult.data;
  const normalizedEmail = email.trim().toLowerCase();
  const user = await AdminUserModel.findOne({ email: normalizedEmail });

  if (!user || user.status !== 'active') {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' });
  }

  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    return res.status(400).json({
      error: 'NO_TOTP_CONFIGURED',
      message: 'Authenticator app 2FA is not configured for this account.',
    });
  }

  const isValid = verifyTotpCode(user.twoFactorSecret, code.trim());
  if (!isValid) {
    return res.status(400).json({
      error: 'INVALID_TOTP',
      message: 'Invalid authenticator code. Please check your authenticator app and try again.',
    });
  }

  // Issue reset token valid for 15 minutes
  const resetToken = generatePasswordResetToken(user._id.toString(), user.email);
  const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

  user.passwordResetOtp = null;
  user.passwordResetToken = {
    tokenHash: resetTokenHash,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  };
  await user.save();

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  await AuditLogModel.create({
    actorRole: user.role,
    actorEmail: user.email,
    actorIp: clientIp,
    tenantId: user.tenantId,
    action: 'PASSWORD_RESET_TOTP_VERIFIED',
    resource: 'ADMIN_USER',
    resourceId: user._id.toString(),
    status: 'SUCCESS',
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    resetToken,
    message: 'Authenticator code confirmed. You can now set your new password.',
  });
});

// D. Verify security questions
authRouter.post('/forgot-password/verify-questions', async (req: Request, res: Response) => {
  const parseResult = forgotPasswordVerifyQuestionsSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { email, answers } = parseResult.data;
  const normalizedEmail = email.trim().toLowerCase();
  const user = await AdminUserModel.findOne({ email: normalizedEmail });

  if (!user || user.status !== 'active') {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' });
  }

  if (!user.securityQuestions || user.securityQuestions.length !== 3) {
    return res.status(400).json({
      error: 'NO_SECURITY_QUESTIONS',
      message: 'Security questions are not configured for this account.',
    });
  }

  // Verify all 3 questions and answers
  let allMatched = true;
  for (const submitted of answers) {
    const stored = user.securityQuestions.find(
      (sq) => sq.question.trim().toLowerCase() === submitted.question.trim().toLowerCase()
    );
    if (!stored) {
      allMatched = false;
      break;
    }
    const isAnswerValid = verifySecurityAnswer(stored.answerHash, submitted.answer);
    if (!isAnswerValid) {
      allMatched = false;
      break;
    }
  }

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  if (!allMatched) {
    await AuditLogModel.create({
      actorRole: user.role,
      actorEmail: user.email,
      actorIp: clientIp,
      tenantId: user.tenantId,
      action: 'PASSWORD_RESET_QUESTIONS_FAILED',
      resource: 'ADMIN_USER',
      resourceId: user._id.toString(),
      status: 'FAILED',
      timestamp: new Date(),
    });

    return res.status(400).json({
      error: 'ANSWERS_INCORRECT',
      message: 'One or more answers do not match our records. Please verify your responses.',
    });
  }

  // Security questions verified: issue reset token valid for 15 minutes
  const resetToken = generatePasswordResetToken(user._id.toString(), user.email);
  const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

  user.passwordResetToken = {
    tokenHash: resetTokenHash,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  };
  await user.save();

  await AuditLogModel.create({
    actorRole: user.role,
    actorEmail: user.email,
    actorIp: clientIp,
    tenantId: user.tenantId,
    action: 'PASSWORD_RESET_QUESTIONS_VERIFIED',
    resource: 'ADMIN_USER',
    resourceId: user._id.toString(),
    status: 'SUCCESS',
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    resetToken,
    message: 'Security questions successfully verified. You can now set your new password.',
  });
});

// D. Verify Emergency Backup Code for Forgot Password
authRouter.post('/forgot-password/verify-backup-code', async (req: Request, res: Response) => {
  const parseResult = forgotPasswordVerifyBackupCodeSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { email, code } = parseResult.data;
  const normalizedEmail = email.trim().toLowerCase();
  const user = await AdminUserModel.findOne({ email: normalizedEmail });

  if (!user || user.status !== 'active') {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' });
  }

  const normalizedCode = code.replace(/[-\s]/g, '').toUpperCase();
  const hashedCode = hashSecurityAnswer(normalizedCode);
  const backupItem = (user.backupCodes || []).find((b) => b.codeHash === hashedCode && !b.used);

  if (!backupItem) {
    return res.status(400).json({
      error: 'INVALID_BACKUP_CODE',
      message: 'Invalid or already used backup code. Please enter an unused emergency code.',
    });
  }

  // Mark the code as used
  backupItem.used = true;
  backupItem.usedAt = new Date();

  // Issue reset token valid for 15 minutes
  const resetToken = generatePasswordResetToken(user._id.toString(), user.email);
  const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

  user.passwordResetOtp = null;
  user.passwordResetToken = {
    tokenHash: resetTokenHash,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  };
  await user.save();

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  await AuditLogModel.create({
    actorRole: user.role,
    actorEmail: user.email,
    actorIp: clientIp,
    tenantId: user.tenantId,
    action: 'PASSWORD_RESET_BACKUP_CODE_VERIFIED',
    resource: 'ADMIN_USER',
    resourceId: user._id.toString(),
    status: 'SUCCESS',
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    resetToken,
    message: 'Emergency backup code verified. You can now set your new password.',
  });
});

// E. Reset Password using resetToken
authRouter.post('/forgot-password/reset', async (req: Request, res: Response) => {
  const parseResult = forgotPasswordResetSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { resetToken, newPassword } = parseResult.data;
  const decoded = verifyPasswordResetToken(resetToken);

  if (!decoded) {
    return res.status(400).json({
      error: 'INVALID_RESET_TOKEN',
      message: 'The password reset session has expired or is invalid. Please restart the recovery process.',
    });
  }

  const user = await AdminUserModel.findById(decoded.userId);
  if (!user || user.status !== 'active') {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' });
  }

  if (!user.passwordResetToken || !user.passwordResetToken.tokenHash) {
    return res.status(400).json({
      error: 'TOKEN_ALREADY_USED',
      message: 'This reset token has already been used or was revoked.',
    });
  }

  if (new Date() > new Date(user.passwordResetToken.expiresAt)) {
    user.passwordResetToken = null;
    await user.save();
    return res.status(410).json({
      error: 'TOKEN_EXPIRED',
      message: 'The reset session has expired. Please restart the recovery process.',
    });
  }

  const incomingTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  if (incomingTokenHash !== user.passwordResetToken.tokenHash) {
    return res.status(400).json({
      error: 'TOKEN_MISMATCH',
      message: 'Invalid reset token.',
    });
  }

  // 1. Sync & validate with Stalwart first if account has a mailbox.
  // Must happen before saving to MongoDB so that weak-password rejections from Stalwart
  // prevent consuming the reset token and prevent desyncing credentials.
  try {
    await MailboxService.syncLoginMailboxPassword(user.email, newPassword);
  } catch (err: any) {
    return res.status(err.status || 400).json({
      error: err.code || 'PASSWORD_REJECTED',
      message: err.message || 'Password was rejected by the mail server.',
    });
  }

  // 2. Hash new password using argon2id and commit to MongoDB
  const newPasswordHash = await hashPassword(newPassword);
  user.passwordHash = newPasswordHash;
  user.passwordResetToken = null;
  user.passwordResetOtp = null;
  await user.save();

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  await AuditLogModel.create({
    actorId: user._id,
    actorRole: user.role,
    actorEmail: user.email,
    actorIp: clientIp,
    tenantId: user.tenantId,
    action: 'PASSWORD_RESET_SUCCESS',
    resource: 'ADMIN_USER',
    resourceId: user._id.toString(),
    status: 'SUCCESS',
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    message: 'Your password has been successfully reset! You can now sign in with your new password.',
  });
});

// ==========================================
// 8. Account Security & Recovery Endpoints
// ==========================================

// 8.1 Get Current Security Settings
authRouter.get('/security/settings', requireAuth, async (req: Request, res: Response) => {
  const adminUser = req.adminUser!;
  const user = await AdminUserModel.findById(adminUser.id);
  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User account not found' });
  }

  const recoveryEmail =
    user.recoveryEmail && user.recoveryEmail.toLowerCase() !== user.email.toLowerCase()
      ? user.recoveryEmail
      : null;

  const remainingBackupCodes = user.backupCodes
    ? user.backupCodes.filter((c: any) => !c.used).length
    : 0;

  return res.status(200).json({
    email: user.email,
    recoveryEmail,
    twoFactorEnabled: user.twoFactorEnabled,
    twoFactorMethod: user.twoFactorMethod || (user.twoFactorEnabled ? 'totp' : null),
    hasTotpConfigured: !!user.twoFactorSecret,
    remainingBackupCodes,
  });
});

// 8.2 Send Verification OTP to New Recovery Email
authRouter.post('/security/recovery-email/send-otp', requireAuth, async (req: Request, res: Response) => {
  const schema = z.object({
    email: z.string().email('Valid recovery email address is required').trim().toLowerCase(),
  });
  const parseResult = schema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { email: recoveryEmail } = parseResult.data;
  const adminUser = req.adminUser!;
  const user = await AdminUserModel.findById(adminUser.id);
  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User account not found' });
  }

  const otpCode = crypto.randomInt(100000, 999999).toString();
  const codeHash = hashSecurityAnswer(otpCode);

  user.recoveryEmailOtp = {
    email: recoveryEmail,
    codeHash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0,
  };
  await user.save();

  await emailService.sendRecoveryEmailVerificationOtpEmail({
    to: recoveryEmail,
    recipientName: user.email,
    otpCode,
    expiresMinutes: 10,
  });

  return res.status(200).json({
    success: true,
    message: `Verification code sent to ${recoveryEmail}`,
    expiresMinutes: 10,
  });
});

// 8.3 Verify OTP and Save Recovery Email
authRouter.post('/security/recovery-email/verify-otp', requireAuth, async (req: Request, res: Response) => {
  const schema = z.object({
    code: z.string().length(6, '6-digit OTP code required').trim(),
  });
  const parseResult = schema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { code } = parseResult.data;
  const adminUser = req.adminUser!;
  const user = await AdminUserModel.findById(adminUser.id);
  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User account not found' });
  }

  if (!user.recoveryEmailOtp || !user.recoveryEmailOtp.codeHash || !user.recoveryEmailOtp.expiresAt) {
    return res.status(400).json({ error: 'NO_OTP_REQUESTED', message: 'No recovery email verification in progress. Please request a new code.' });
  }

  if (new Date() > new Date(user.recoveryEmailOtp.expiresAt)) {
    user.recoveryEmailOtp = null;
    await user.save();
    return res.status(400).json({ error: 'OTP_EXPIRED', message: 'Verification code has expired. Please request a new code.' });
  }

  if (user.recoveryEmailOtp.attempts >= 5) {
    user.recoveryEmailOtp = null;
    await user.save();
    return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many incorrect attempts. Please request a new verification code.' });
  }

  const incomingHash = hashSecurityAnswer(code);
  const isMatch = crypto.timingSafeEqual(Buffer.from(user.recoveryEmailOtp.codeHash), Buffer.from(incomingHash));
  if (!isMatch) {
    user.recoveryEmailOtp.attempts += 1;
    await user.save();
    return res.status(400).json({ error: 'INVALID_CODE', message: 'Incorrect 6-digit verification code.' });
  }

  const newRecoveryEmail = user.recoveryEmailOtp.email;
  user.recoveryEmail = newRecoveryEmail;
  user.recoveryEmailOtp = null;
  await user.save();

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  await AuditLogModel.create({
    actorId: user._id,
    actorRole: user.role,
    actorEmail: user.email,
    tenantId: user.tenantId,
    action: 'ADMIN_RECOVERY_EMAIL_UPDATED',
    resource: 'ADMIN_USER',
    resourceId: user._id.toString(),
    status: 'SUCCESS',
    metadata: { recoveryEmail: newRecoveryEmail },
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    message: 'Recovery email verified and updated successfully.',
    recoveryEmail: newRecoveryEmail,
  });
});

// 8.4 Remove Recovery Email
authRouter.delete('/security/recovery-email', requireAuth, async (req: Request, res: Response) => {
  const adminUser = req.adminUser!;
  const user = await AdminUserModel.findById(adminUser.id);
  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User account not found' });
  }

  user.recoveryEmail = null;
  user.recoveryEmailOtp = null;
  await user.save();

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  await AuditLogModel.create({
    actorId: user._id,
    actorRole: user.role,
    actorEmail: user.email,
    tenantId: user.tenantId,
    action: 'ADMIN_RECOVERY_EMAIL_REMOVED',
    resource: 'ADMIN_USER',
    resourceId: user._id.toString(),
    status: 'SUCCESS',
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    message: 'Recovery email removed successfully.',
  });
});

// 8.5 Switch / Configure 2FA Mode ('totp' | 'email' | 'disabled')
authRouter.post('/security/2fa/mode', requireAuth, async (req: Request, res: Response) => {
  const schema = z.object({
    mode: z.enum(['totp', 'email', 'disabled']),
  });
  const parseResult = schema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { mode } = parseResult.data;
  const adminUser = req.adminUser!;
  const user = await AdminUserModel.findById(adminUser.id);
  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User account not found' });
  }

  if (mode === 'totp') {
    if (!user.twoFactorSecret) {
      return res.status(400).json({
        error: 'TOTP_NOT_CONFIGURED',
        message: 'Please complete Authenticator app setup before enabling TOTP 2FA.',
      });
    }
    user.twoFactorEnabled = true;
    user.twoFactorMethod = 'totp';
  } else if (mode === 'email') {
    user.twoFactorEnabled = true;
    user.twoFactorMethod = 'email';
  } else {
    // disabled
    user.twoFactorEnabled = false;
    user.twoFactorMethod = undefined;
  }

  let backupCodes: string[] | undefined;
  if (user.twoFactorEnabled && (!user.backupCodes || user.backupCodes.length === 0)) {
    const generated = generateBackupCodes(10);
    user.backupCodes = generated.hashedCodes as any;
    backupCodes = generated.plainCodes;

    try {
      await emailService.sendBackupCodesEmail({
        to: user.email,
        recipientName: user.name || user.email,
        backupCodes: generated.plainCodes,
      });
    } catch (err) {
      console.error('Failed to send backup codes email during 2FA mode switch:', err);
    }
  }

  await user.save();

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  await AuditLogModel.create({
    actorId: user._id,
    actorRole: user.role,
    actorEmail: user.email,
    tenantId: user.tenantId,
    action: mode === 'disabled' ? 'ADMIN_2FA_DISABLED' : 'ADMIN_2FA_ENABLED',
    resource: 'ADMIN_USER',
    resourceId: user._id.toString(),
    status: 'SUCCESS',
    metadata: { twoFactorMode: mode },
    timestamp: new Date(),
  });

  const remainingBackupCodes = user.backupCodes
    ? user.backupCodes.filter((c: any) => !c.used).length
    : 0;

  return res.status(200).json({
    success: true,
    message: `Two-factor authentication updated to: ${mode}`,
    twoFactorEnabled: user.twoFactorEnabled,
    twoFactorMethod: user.twoFactorMethod || null,
    backupCodes,
    remainingBackupCodes,
  });
});

// 8.6 Regenerate 2FA Backup Codes
authRouter.post('/security/2fa/backup-codes/regenerate', requireAuth, async (req: Request, res: Response) => {
  const adminUser = req.adminUser!;
  const user = await AdminUserModel.findById(adminUser.id);
  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User account not found' });
  }

  if (!user.twoFactorEnabled) {
    return res.status(400).json({ error: '2FA_NOT_ENABLED', message: 'Two-factor authentication must be enabled to regenerate backup codes.' });
  }

  const generated = generateBackupCodes(10);
  user.backupCodes = generated.hashedCodes as any;
  await user.save();

  try {
    await emailService.sendBackupCodesEmail({
      to: user.email,
      recipientName: user.name || user.email,
      backupCodes: generated.plainCodes,
    });
  } catch (err) {
    console.error('Failed to send backup codes email during regeneration:', err);
  }

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  await AuditLogModel.create({
    actorId: user._id,
    actorRole: user.role,
    actorEmail: user.email,
    tenantId: user.tenantId,
    action: 'ADMIN_BACKUP_CODES_REGENERATED',
    resource: 'ADMIN_USER',
    resourceId: user._id.toString(),
    status: 'SUCCESS',
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    message: 'New backup codes generated and emailed successfully.',
    backupCodes: generated.plainCodes,
    remainingBackupCodes: generated.plainCodes.length,
  });
});

