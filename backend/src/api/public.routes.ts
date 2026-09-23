import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { ActivationTokenModel } from '../db/models/ActivationToken';
import { AdminUserModel } from '../db/models/AdminUser';
import { AuditLogModel } from '../db/models/AuditLog';
import { emailService } from '../services/email.service';
import { getDefaultPlanSeatCount } from '../services/plan.service';
import { checkAndIncrementRateLimit, resetAllRateLimits } from '../utils/rate-limit';
import { isRegistrationEmailBlocked, REGISTRATION_EMAIL_BLOCKED_RESPONSE } from '../services/registration-block.service';
import { cleanIpAddress } from '../services/session.service';
import { BlockedRegistrationIdentityModel } from '../db/models/BlockedRegistrationIdentity';
import { normalizeRegistrationEmail } from '../utils/email-identity';
import { MailboxService } from '../services/mailbox.service';
import { config } from '../config';
import {
  hashPassword,
  verifyPassword,
  generateOidcToken,
  generateTotpSecret,
  generateTotpQrCode,
  verifyTotpCode,
  hashSecurityAnswer,
  generateRecoveryEmailVerificationToken,
  verifyRecoveryEmailVerificationToken,
  generateContactEmailVerificationToken,
  verifyContactEmailVerificationToken,
  generateTotpSetupToken,
  verifyTotpSetupToken,
  generateBackupCodes,
} from '../auth/service';

export const publicRouter = Router();

// Rate limiter for public registration: max 5 requests per hour per IP —
// backed by MongoDB (see utils/rate-limit.ts) so it survives backend
// restarts/redeploys instead of resetting like an in-memory Map would.
export function registrationRateLimiter(windowMs: number = 60 * 60 * 1000, maxAttempts: number = 5) {
  return async (req: Request, res: Response, next: () => void) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `register:${ip}`;

    try {
      const { blocked, retryAfterSeconds } = await checkAndIncrementRateLimit(key, windowMs, maxAttempts);
      if (blocked) {
        res.setHeader('Retry-After', retryAfterSeconds);
        return res.status(429).json({
          error: 'RATE_LIMIT_EXCEEDED',
          message: `Too many registration attempts from this IP. Please try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`,
        });
      }
    } catch (err) {
      console.error('[Registration Rate Limiter] Store error, allowing request through:', err);
    }

    next();
  };
}

function requestIp(req: Request): string {
  return cleanIpAddress(req.ip || req.socket.remoteAddress);
}

export async function resetRegistrationRateLimitStore(): Promise<void> {
  await resetAllRateLimits('register:');
}

interface RecoveryOtpEntry {
  codeHash: string;
  expiresAt: number;
  attempts: number;
}
const recoveryEmailOtpStore = new Map<string, RecoveryOtpEntry>();

export function resetRecoveryEmailOtpStore() {
  recoveryEmailOtpStore.clear();
}

// 1. Send OTP to Recovery Email
publicRouter.post('/recovery-email/send-otp', async (req: Request, res: Response) => {
  const schema = z.object({ email: z.string().email('Valid recovery email is required') });
  const parseResult = schema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const normalizedEmail = parseResult.data.email.trim().toLowerCase();
  const otpCode = crypto.randomInt(100000, 999999).toString();
  const codeHash = crypto.createHash('sha256').update(otpCode).digest('hex');

  recoveryEmailOtpStore.set(normalizedEmail, {
    codeHash,
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0,
  });

  await emailService.sendRecoveryEmailVerificationOtpEmail({
    to: normalizedEmail,
    otpCode,
    expiresMinutes: 10,
  });

  return res.status(200).json({
    success: true,
    message: 'Verification code sent to recovery email',
    expiresMinutes: 10,
  });
});

// 2. Verify Recovery Email OTP
publicRouter.post('/recovery-email/verify-otp', async (req: Request, res: Response) => {
  const schema = z.object({
    email: z.string().email('Valid recovery email is required'),
    code: z.string().regex(/^\d{6}$/, '6-digit verification code is required'),
  });
  const parseResult = schema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const normalizedEmail = parseResult.data.email.trim().toLowerCase();
  const entry = recoveryEmailOtpStore.get(normalizedEmail);

  if (!entry || Date.now() > entry.expiresAt) {
    recoveryEmailOtpStore.delete(normalizedEmail);
    return res.status(400).json({
      error: 'OTP_EXPIRED_OR_NOT_FOUND',
      message: 'Verification code has expired or was not requested. Please request a new code.',
    });
  }

  if (entry.attempts >= 5) {
    recoveryEmailOtpStore.delete(normalizedEmail);
    return res.status(429).json({
      error: 'TOO_MANY_ATTEMPTS',
      message: 'Too many invalid attempts. Please request a new verification code.',
    });
  }

  const incomingHash = crypto.createHash('sha256').update(parseResult.data.code.trim()).digest('hex');
  const isMatch = crypto.timingSafeEqual(Buffer.from(entry.codeHash), Buffer.from(incomingHash));

  if (!isMatch) {
    entry.attempts += 1;
    return res.status(400).json({
      error: 'INVALID_OTP',
      message: 'Invalid verification code. Please check your email and try again.',
    });
  }

  recoveryEmailOtpStore.delete(normalizedEmail);
  const verificationToken = generateRecoveryEmailVerificationToken(normalizedEmail);

  return res.status(200).json({
    success: true,
    message: 'Recovery email successfully verified',
    verificationToken,
  });
});

// Contact Email OTP Store (for Step 2 primary admin email verification)
interface ContactOtpEntry {
  codeHash: string;
  expiresAt: number;
  attempts: number;
}
const contactEmailOtpStore = new Map<string, ContactOtpEntry>();

export function resetContactEmailOtpStore() {
  contactEmailOtpStore.clear();
}

// 2b. Send OTP to Contact Email
publicRouter.post('/contact-email/send-otp', async (req: Request, res: Response) => {
  const schema = z.object({ email: z.string().email('Valid contact email is required') });
  const parseResult = schema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const normalizedEmail = parseResult.data.email.trim().toLowerCase();

  // A deleted organisation's registration email is permanently barred from registering again.
  if (await isRegistrationEmailBlocked(normalizedEmail, { ip: requestIp(req), source: 'contact-email/send-otp' })) {
    return res.status(403).json(REGISTRATION_EMAIL_BLOCKED_RESPONSE);
  }

  // Check if account already exists with this email
  const existingUser = await AdminUserModel.findOne({ email: normalizedEmail });
  if (existingUser) {
    return res.status(409).json({
      error: 'EMAIL_ALREADY_EXISTS',
      message: 'An account with this email address already exists. Please sign in instead.',
    });
  }

  const otpCode = crypto.randomInt(100000, 999999).toString();
  const codeHash = crypto.createHash('sha256').update(otpCode).digest('hex');

  contactEmailOtpStore.set(normalizedEmail, {
    codeHash,
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0,
  });

  await emailService.sendContactEmailVerificationOtpEmail({
    to: normalizedEmail,
    otpCode,
    expiresMinutes: 10,
  });

  return res.status(200).json({
    success: true,
    message: 'Verification code sent to contact email',
    expiresMinutes: 10,
  });
});

// 2c. Verify Contact Email OTP
publicRouter.post('/contact-email/verify-otp', async (req: Request, res: Response) => {
  const schema = z.object({
    email: z.string().email('Valid contact email is required'),
    code: z.string().regex(/^\d{6}$/, '6-digit verification code is required'),
  });
  const parseResult = schema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const normalizedEmail = parseResult.data.email.trim().toLowerCase();
  const entry = contactEmailOtpStore.get(normalizedEmail);

  if (!entry || Date.now() > entry.expiresAt) {
    contactEmailOtpStore.delete(normalizedEmail);
    return res.status(400).json({
      error: 'OTP_EXPIRED_OR_NOT_FOUND',
      message: 'Verification code has expired or was not requested. Please request a new code.',
    });
  }

  if (entry.attempts >= 5) {
    contactEmailOtpStore.delete(normalizedEmail);
    return res.status(429).json({
      error: 'TOO_MANY_ATTEMPTS',
      message: 'Too many invalid attempts. Please request a new verification code.',
    });
  }

  const incomingHash = crypto.createHash('sha256').update(parseResult.data.code.trim()).digest('hex');
  const isMatch = crypto.timingSafeEqual(Buffer.from(entry.codeHash), Buffer.from(incomingHash));

  if (!isMatch) {
    entry.attempts += 1;
    return res.status(400).json({
      error: 'INVALID_OTP',
      message: 'Invalid verification code. Please check your email and try again.',
    });
  }

  contactEmailOtpStore.delete(normalizedEmail);
  const verificationToken = generateContactEmailVerificationToken(normalizedEmail);

  return res.status(200).json({
    success: true,
    message: 'Contact email successfully verified',
    verificationToken,
  });
});

// Usernames become a real mailbox local part, so they follow the mailbox charset
// (services/mailbox.service.ts) but tightened: lowercase, 3-30 chars, must start alphanumeric.
// '+' is excluded deliberately — normalizeRegistrationEmail() strips +tags, so allowing it would
// let two different usernames collapse to the same blocked identity.
const USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{2,29}$/;

// Addresses RFC 2142 requires, plus the ones that would let someone impersonate the platform.
const RESERVED_USERNAMES = new Set([
  'postmaster', 'abuse', 'hostmaster', 'webmaster', 'root', 'admin', 'administrator',
  'noreply', 'no-reply', 'mailer-daemon', 'daemon', 'support', 'help', 'info', 'mail',
  'security', 'billing', 'sales', 'api', 'system', 'test', 'toowix', 'dhkmail',
]);

/** Format/reserved rules only — no DB access, so both the probe and registration share them. */
function validateUsername(raw: string): { username: string } | { error: string } {
  const username = (raw || '').trim().toLowerCase();
  if (!USERNAME_REGEX.test(username)) {
    return {
      error:
        'Use 3-30 characters: lowercase letters, numbers, dots, dashes or underscores, starting with a letter or number.',
    };
  }
  if (RESERVED_USERNAMES.has(username)) {
    return { error: 'That username is reserved. Please choose another.' };
  }
  return { username };
}

const platformAddress = (username: string) => `${username}@${config.platformMailDomain}`;

// 2c-i. Username availability for the signup wizard.
// Deliberately checks BlockedRegistrationIdentity directly instead of isRegistrationEmailBlocked():
// the wizard probes this on every keystroke, and the logging variant would bury genuine refused
// re-registration attempts under typing noise.
publicRouter.get('/username-availability', async (req: Request, res: Response) => {
  const checked = validateUsername(String(req.query.username || ''));
  if ('error' in checked) {
    return res.status(200).json({ available: false, reason: checked.error });
  }

  const address = platformAddress(checked.username);
  const [taken, blocked] = await Promise.all([
    AdminUserModel.exists({ email: address }),
    BlockedRegistrationIdentityModel.exists({ emailNormalized: normalizeRegistrationEmail(address) }),
  ]);

  if (taken || blocked) {
    return res.status(200).json({ available: false, reason: 'That username is already taken.' });
  }
  return res.status(200).json({ available: true, address });
});

const directRegisterSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  // The same rules the signup form shows live. The password also becomes the mailbox credential,
  // and the mail server rejects weak ones only at the very last step — so fail early and clearly.
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[a-z]/, 'Password needs a lowercase letter')
    .regex(/[A-Z]/, 'Password needs an uppercase letter')
    .regex(/[0-9]/, 'Password needs a number')
    .regex(/[^A-Za-z0-9]/, 'Password needs a special character'),
  recoveryEmail: z.string().email('Valid recovery email is required'),
  recoveryEmailVerificationToken: z.string().min(1, 'Recovery email verification token is required'),
  organizationName: z.string().trim().min(2, 'Organization name must be at least 2 characters').max(100).optional(),
  securityQuestions: z
    .array(
      z.object({
        question: z.string().min(3, 'Security question is required'),
        answer: z.string().min(1, 'Security answer is required'),
      })
    )
    .length(3, 'Exactly 3 security questions are required')
    .refine(
      (items) => {
        const questions = items.map((q) => q.question.trim().toLowerCase());
        return new Set(questions).size === 3;
      },
      {
        message: 'You must select exactly 3 unique security questions',
      }
    ),
});

// 2d. Direct self-service registration: username -> password -> recovery email -> OTP -> questions.
// The username becomes BOTH the login (AdminUser.email) and a real mailbox on the platform domain.
publicRouter.post('/register', registrationRateLimiter(), async (req: Request, res: Response) => {
  const parseResult = directRegisterSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const {
    username: rawUsername,
    password,
    recoveryEmail,
    recoveryEmailVerificationToken,
    securityQuestions,
    organizationName,
  } = parseResult.data;

  const checked = validateUsername(rawUsername);
  if ('error' in checked) {
    return res.status(400).json({ error: 'INVALID_USERNAME', message: checked.error });
  }
  const { username } = checked;
  const loginEmail = platformAddress(username);
  const normalizedRecoveryEmail = recoveryEmail.trim().toLowerCase();

  // Checked before the token so a still-valid verification token can't slip past a burned username.
  if (await isRegistrationEmailBlocked(loginEmail, { ip: requestIp(req), source: 'register' })) {
    return res.status(403).json(REGISTRATION_EMAIL_BLOCKED_RESPONSE);
  }

  // 1. The recovery email must have been OTP-verified in this same flow. It is the only address we
  //    can reach this user on if they ever lose access to their platform mailbox.
  const tokenPayload = verifyRecoveryEmailVerificationToken(recoveryEmailVerificationToken);
  if (!tokenPayload || tokenPayload.email !== normalizedRecoveryEmail) {
    return res.status(400).json({
      error: 'INVALID_VERIFICATION_TOKEN',
      message: 'Recovery email verification has expired or is invalid. Please verify your recovery email again.',
    });
  }

  // 2. Username still free? (The unique index on Mailbox.address is the real race guard below.)
  if (await AdminUserModel.exists({ email: loginEmail })) {
    return res.status(409).json({
      error: 'USERNAME_TAKEN',
      message: 'That username is already taken. Please choose another.',
    });
  }

  // 3. Hash password and security questions
  const passwordHash = await hashPassword(password);
  const processedSecurityQuestions = securityQuestions.map((sq) => ({
    question: sq.question.trim(),
    answerHash: hashSecurityAnswer(sq.answer),
  }));

  // 4. Provision the mailbox FIRST: it is the only step touching an external system, so it is the
  //    cheapest point to fail — nothing else has been written yet.
  try {
    await MailboxService.createPlatformIdentityMailbox(username, password);
  } catch (err: any) {
    if (err?.status && err?.code) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    throw err;
  }

  const formattedName = username.charAt(0).toUpperCase() + username.slice(1);
  let tenant;
  let adminUser;

  try {
    // 5. Tenant. contactEmail is the RECOVERY address, not the platform one — Stripe receipts,
    //    dunning and domain-activation notices must reach an inbox outside this platform.
    tenant = await TenantModel.create({
      name: organizationName?.trim() || `${formattedName}'s Organization`,
      contactEmail: normalizedRecoveryEmail,
      status: 'active',
      mailboxLimit: await getDefaultPlanSeatCount(),
      mailboxCount: 0,
    });

    // 6. Tenant admin. Login identity is the platform address; recovery is the verified external one.
    adminUser = await AdminUserModel.create({
      email: loginEmail,
      name: formattedName,
      passwordHash,
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
      status: 'active',
      twoFactorEnabled: false,
      recoveryEmail: normalizedRecoveryEmail,
      securityQuestions: processedSecurityQuestions,
    });
  } catch (err) {
    // Never strand a username on a half-finished signup.
    await MailboxService.deletePlatformIdentityMailbox(loginEmail);
    if (tenant) await TenantModel.deleteOne({ _id: tenant._id });
    throw err;
  }

  // 7. Audit log
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  await AuditLogModel.create({
    actorId: adminUser._id,
    actorRole: 'TENANT_ADMIN',
    actorEmail: adminUser.email,
    actorIp: clientIp,
    tenantId: tenant._id,
    action: 'TENANT_ADMIN_REGISTERED',
    resource: 'ADMIN_USER',
    resourceId: adminUser._id.toString(),
    status: 'SUCCESS',
    metadata: {
      tenantId: tenant._id.toString(),
      tenantName: tenant.name,
    },
    timestamp: new Date(),
  });

  return res.status(201).json({
    success: true,
    message: 'Registration successful! You can now log in to your account.',
    user: {
      id: adminUser._id.toString(),
      email: adminUser.email,
    },
  });
});

// 3. Setup Authenticator App (TOTP) during public registration
publicRouter.post('/totp/setup', async (req: Request, res: Response) => {
  const label = req.body?.label || 'Toowix Admin';
  const { secret, otpauthUrl } = generateTotpSecret(label);
  const qrCodeDataUrl = await generateTotpQrCode(otpauthUrl);

  return res.status(200).json({
    success: true,
    secret,
    qrCodeDataUrl,
  });
});

// 4. Verify Authenticator App code during public registration
publicRouter.post('/totp/verify', async (req: Request, res: Response) => {
  const schema = z.object({
    secret: z.string().min(16, 'Valid TOTP secret is required'),
    code: z.string().regex(/^\d{6}$/, '6-digit authenticator code is required'),
  });
  const parseResult = schema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { secret, code } = parseResult.data;
  const isCodeValid = verifyTotpCode(secret, code);

  if (!isCodeValid) {
    return res.status(400).json({
      error: 'INVALID_2FA_CODE',
      message: 'Invalid 6-digit authenticator code. Please check your app and try again.',
    });
  }

  const totpSetupToken = generateTotpSetupToken(secret);
  return res.status(200).json({
    success: true,
    message: 'Authenticator app successfully verified',
    totpSetupToken,
  });
});

// GET /api/public/activate-token/:token - Validate activation link token
publicRouter.get('/activate-token/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!token || token.length < 32) {
    return res.status(400).json({ valid: false, error: 'INVALID_TOKEN', message: 'Malformed activation token' });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const tokenDoc = await ActivationTokenModel.findOne({ tokenHash });

  if (!tokenDoc) {
    return res.status(404).json({ valid: false, error: 'TOKEN_NOT_FOUND', message: 'Activation token not found' });
  }

  if (tokenDoc.usedAt) {
    return res.status(410).json({ valid: false, error: 'TOKEN_ALREADY_USED', message: 'This activation token has already been used' });
  }

  if (tokenDoc.expiresAt < new Date()) {
    return res.status(410).json({ valid: false, error: 'TOKEN_EXPIRED', message: 'This activation token has expired' });
  }

  const tenant = await TenantModel.findById(tokenDoc.tenantId);
  const domain = await DomainModel.findOne({ tenantId: tokenDoc.tenantId });

  if (!tenant || !domain) {
    return res.status(404).json({ valid: false, error: 'TENANT_NOT_FOUND', message: 'Associated tenant could not be found' });
  }

  // Generate TOTP secret and QR code for mandatory 2FA enrollment
  const { secret: totpSecret, otpauthUrl } = generateTotpSecret(tokenDoc.contactEmail);
  const qrCodeDataUrl = await generateTotpQrCode(otpauthUrl);

  return res.status(200).json({
    valid: true,
    tenant: {
      id: tenant._id.toString(),
      name: tenant.name,
      status: tenant.status,
    },
    domain: domain.domainName,
    contactEmail: tokenDoc.contactEmail,
    totpSecret,
    qrCodeDataUrl,
    hasRegistrationPassword: false,
  });
});

const verifyActivationPasswordSchema = z.object({
  token: z.string().min(32, 'Valid token is required'),
  password: z.string().min(1, 'Password is required'),
});

// POST /api/public/verify-activation-password - Validate administrator password set during registration
publicRouter.post('/verify-activation-password', async (req: Request, res: Response) => {
  const parseResult = verifyActivationPasswordSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ valid: false, error: 'VALIDATION_ERROR', message: 'Token and password are required' });
  }

  const { token, password } = parseResult.data;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const tokenDoc = await ActivationTokenModel.findOne({ tokenHash });

  if (!tokenDoc) {
    return res.status(404).json({ valid: false, error: 'TOKEN_NOT_FOUND', message: 'Activation token not found' });
  }

  if (tokenDoc.usedAt) {
    return res.status(410).json({ valid: false, error: 'TOKEN_ALREADY_USED', message: 'This activation token has already been used' });
  }

  if (tokenDoc.expiresAt < new Date()) {
    return res.status(410).json({ valid: false, error: 'TOKEN_EXPIRED', message: 'This activation token has expired' });
  }

  if (password.length < 8) {
    return res.status(400).json({
      valid: false,
      error: 'INVALID_PASSWORD',
      message: 'Password must be at least 8 characters.',
    });
  }

  return res.status(200).json({ valid: true, message: 'Password verified successfully' });
});

const completeActivationSchema = z.object({
  token: z.string().min(32, 'Valid token is required'),
  email: z.string().email('Valid administrator email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  totpSecret: z.string().min(16, 'Valid TOTP secret is required'),
  totpCode: z.string().regex(/^\d{6}$/, '6-digit authenticator code is required'),
});

// POST /api/public/activate - Complete onboarding & set administrator credentials with mandatory 2FA
publicRouter.post('/activate', async (req: Request, res: Response) => {
  const parseResult = completeActivationSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { token, email, password, totpSecret, totpCode } = parseResult.data;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const tokenDoc = await ActivationTokenModel.findOne({ tokenHash });

  if (!tokenDoc) {
    return res.status(404).json({ error: 'TOKEN_NOT_FOUND', message: 'Activation token not found' });
  }

  if (tokenDoc.usedAt) {
    return res.status(410).json({ error: 'TOKEN_ALREADY_USED', message: 'This activation token has already been used' });
  }

  if (tokenDoc.expiresAt < new Date()) {
    return res.status(410).json({ error: 'TOKEN_EXPIRED', message: 'This activation token has expired' });
  }

  const tenant = await TenantModel.findById(tokenDoc.tenantId);
  if (!tenant) {
    return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Associated tenant could not be found' });
  }

  // Verify mandatory TOTP 2FA code
  const is2FaValid = verifyTotpCode(totpSecret, totpCode);
  if (!is2FaValid) {
    return res.status(400).json({
      error: 'INVALID_2FA_CODE',
      message: 'Invalid 6-digit authenticator code. Please check your authenticator app and try again.',
    });
  }

  const normalizedEmail = email.toLowerCase().trim();

  if (await isRegistrationEmailBlocked(normalizedEmail, { ip: requestIp(req), source: 'activate' })) {
    return res.status(403).json(REGISTRATION_EMAIL_BLOCKED_RESPONSE);
  }

  // Ensure no existing admin user with this email
  const existingUser = await AdminUserModel.findOne({ email: normalizedEmail });
  if (existingUser) {
    return res.status(409).json({ error: 'EMAIL_EXISTS', message: 'An admin user with this email already exists' });
  }

  const passwordHash = await hashPassword(password);

  // Generate 10 emergency backup codes
  const { plainCodes, hashedCodes } = generateBackupCodes(10);

  // Create Tenant Admin User with mandatory 2FA enabled and recovery profile
  const adminUser = await AdminUserModel.create({
    email: normalizedEmail,
    passwordHash,
    role: 'TENANT_ADMIN',
    tenantId: tenant._id,
    status: 'active',
    twoFactorEnabled: true,
    twoFactorMethod: 'totp',
    twoFactorSecret: totpSecret,
    backupCodes: hashedCodes,
    recoveryEmail: null,
    securityQuestions: [],
  });

  try {
    await emailService.sendBackupCodesEmail({
      to: adminUser.email,
      recipientName: adminUser.name || adminUser.email,
      backupCodes: plainCodes,
    });
  } catch (err) {
    console.error('Failed to send backup codes email during tenant activation:', err);
  }

  // Transition tenant to active if pending setup
  if (tenant.status === 'approved_pending_setup') {
    tenant.status = 'active';
    await tenant.save();
  }

  // Mark token as used
  tokenDoc.usedAt = new Date();
  await tokenDoc.save();

  // Audit activation
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  await AuditLogModel.create({
    actorId: adminUser._id,
    actorRole: 'TENANT_ADMIN',
    actorEmail: adminUser.email,
    actorIp: clientIp,
    tenantId: tenant._id,
    action: 'TENANT_ADMIN_ACTIVATED',
    resource: 'ADMIN_USER',
    resourceId: adminUser._id.toString(),
    status: 'SUCCESS',
    metadata: {
      tenantId: tenant._id.toString(),
      tenantName: tenant.name,
      twoFactorEnabled: true,
    },
    timestamp: new Date(),
  });

  // Issue session token with two_factor_verified = true
  const authToken = generateOidcToken({
    id: adminUser._id.toString(),
    email: adminUser.email,
    role: 'TENANT_ADMIN',
    tenantId: tenant._id.toString(),
    twoFactorEnabled: true,
  });

  return res.status(200).json({
    success: true,
    message: 'Tenant successfully activated with two-factor authentication enabled! Welcome to Toowix Mail Platform.',
    token: authToken,
    backupCodes: plainCodes,
    user: {
      id: adminUser._id.toString(),
      email: adminUser.email,
      role: 'TENANT_ADMIN',
      tenantId: tenant._id.toString(),
      twoFactorEnabled: true,
    },
  });
});
