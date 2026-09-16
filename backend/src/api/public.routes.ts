import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { RegistrationApplicationModel } from '../db/models/RegistrationApplication';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { ActivationTokenModel } from '../db/models/ActivationToken';
import { AdminUserModel } from '../db/models/AdminUser';
import { AuditLogModel } from '../db/models/AuditLog';
import { emailService } from '../services/email.service';
import { getDefaultPlanSeatCount } from '../services/plan.service';
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

// In-memory rate limiter for public registration: max 5 requests per hour per IP
interface RegRateLimit {
  count: number;
  resetAt: number;
}
const regRateLimitMap = new Map<string, RegRateLimit>();

export function registrationRateLimiter(windowMs: number = 60 * 60 * 1000, maxAttempts: number = 5) {
  return (req: Request, res: Response, next: () => void) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = regRateLimitMap.get(ip);

    if (entry && entry.resetAt > now) {
      if (entry.count >= maxAttempts) {
        const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
        res.setHeader('Retry-After', retryAfterSeconds);
        return res.status(429).json({
          error: 'RATE_LIMIT_EXCEEDED',
          message: `Too many registration attempts from this IP. Please try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`,
        });
      }
      entry.count += 1;
    } else {
      regRateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    }

    next();
  };
}

export function resetRegistrationRateLimitStore() {
  regRateLimitMap.clear();
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

const directRegisterSchema = z.object({
  email: z.string().email('Valid email is required'),
  emailVerificationToken: z.string().min(1, 'Email verification token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  securityQuestions: z
    .array(
      z.object({
        question: z.string().min(3, 'Security question is required'),
        answer: z.string().min(2, 'Security answer must be at least 2 characters'),
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

// 2d. Direct Self-Service Registration (Email -> OTP -> Password -> Security Questions)
publicRouter.post('/register', registrationRateLimiter(), async (req: Request, res: Response) => {
  const parseResult = directRegisterSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { email, emailVerificationToken, password, securityQuestions } = parseResult.data;
  const normalizedEmail = email.trim().toLowerCase();

  // 1. Verify email verification token
  const tokenPayload = verifyContactEmailVerificationToken(emailVerificationToken);
  if (!tokenPayload || tokenPayload.email !== normalizedEmail) {
    return res.status(400).json({
      error: 'INVALID_VERIFICATION_TOKEN',
      message: 'Email verification code has expired or is invalid. Please verify your email again.',
    });
  }

  // 2. Check if email already registered
  const existingUser = await AdminUserModel.findOne({ email: normalizedEmail });
  if (existingUser) {
    return res.status(409).json({
      error: 'EMAIL_ALREADY_EXISTS',
      message: 'An account with this email address already exists. Please sign in instead.',
    });
  }

  // 3. Hash password and security questions
  const passwordHash = await hashPassword(password);
  const processedSecurityQuestions = securityQuestions.map((sq) => ({
    question: sq.question.trim(),
    answerHash: hashSecurityAnswer(sq.answer),
  }));

  // 4. Create Tenant with active status
  const baseName = normalizedEmail.split('@')[0];
  const formattedName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
  const tenant = await TenantModel.create({
    name: `${formattedName}'s Organization`,
    contactEmail: normalizedEmail,
    status: 'active',
    mailboxLimit: await getDefaultPlanSeatCount(),
    mailboxCount: 0,
  });

  // 5. Create Tenant Admin User (active, 2FA disabled initially, with security questions)
  const adminUser = await AdminUserModel.create({
    email: normalizedEmail,
    name: formattedName,
    passwordHash,
    role: 'TENANT_ADMIN',
    tenantId: tenant._id,
    status: 'active',
    twoFactorEnabled: false,
    recoveryEmail: normalizedEmail,
    securityQuestions: processedSecurityQuestions,
  });

  // 6. Audit log
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

const RESERVED_DOMAINS = [
  'toowix.com',
  'toowix.test',
  'toowix.net',
  'localhost',
  'local',
  'example.com',
  'test.com',
];

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const registerTenantSchema = z.object({
  companyName: z.string().min(2, 'Company name must be at least 2 characters').max(100),
  requestedDomain: z
    .string()
    .min(3, 'Domain must be at least 3 characters')
    .max(253)
    .refine((val) => DOMAIN_REGEX.test(val.trim().toLowerCase()), {
      message: 'Invalid domain format (e.g., example.com)',
    })
    .refine((val) => !RESERVED_DOMAINS.includes(val.trim().toLowerCase()), {
      message: 'This domain name is reserved and cannot be registered.',
    }),
  applicantName: z.string().min(2, 'Applicant name must be at least 2 characters').max(100).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  contactEmail: z.string().email('Valid external contact email is required'),
  recoveryEmail: z.string().email('Valid recovery email is required').optional(),
  securityQuestions: z
    .array(
      z.object({
        question: z.string().min(3, 'Security question must be at least 3 characters'),
        answer: z.string().min(2, 'Security answer must be at least 2 characters'),
      })
    )
    .optional()
    .refine(
      (items) => {
        if (!items || items.length === 0) return true;
        if (items.length !== 3) return false;
        const questions = items.map((q) => q.question.trim().toLowerCase());
        return new Set(questions).size === 3;
      },
      {
        message: 'You must select exactly 3 unique security questions',
      }
    ),
  phone: z.string().max(30).optional(),
  notes: z.string().max(1000).optional(),
  employeeCount: z.string().max(50).optional(),
  region: z.string().max(100).optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  recoveryEmailVerificationToken: z.string().optional(),
  contactEmailVerificationToken: z.string().optional(),
  totpSetupToken: z.string().optional(),
});

// POST /api/public/register-tenant
publicRouter.post('/register-tenant', registrationRateLimiter(), async (req: Request, res: Response) => {
  const parseResult = registerTenantSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const {
    companyName,
    requestedDomain,
    applicantName: rawApplicantName,
    firstName,
    lastName,
    contactEmail,
    recoveryEmail,
    securityQuestions,
    phone,
    notes,
    employeeCount,
    region,
    password,
    recoveryEmailVerificationToken,
    contactEmailVerificationToken,
    totpSetupToken,
  } = parseResult.data;

  // Resolve applicant name from first/last name or direct applicantName
  const resolvedApplicantName =
    rawApplicantName?.trim() ||
    [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ') ||
    'Organization Admin';

  const normalizedDomain = requestedDomain.trim().toLowerCase();
  const normalizedEmail = contactEmail.trim().toLowerCase();
  const normalizedRecoveryEmail = recoveryEmail ? recoveryEmail.trim().toLowerCase() : null;
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  // 1. Check if domain is already actively provisioned
  const existingDomain = await DomainModel.findOne({ domainName: normalizedDomain });
  if (existingDomain) {
    return res.status(409).json({
      error: 'DOMAIN_ALREADY_EXISTS',
      message: 'The requested domain is already registered on this platform.',
    });
  }

  // 2. Check if an application is already pending review for this domain
  const existingPendingApp = await RegistrationApplicationModel.findOne({
    requestedDomain: normalizedDomain,
    status: 'PENDING_REVIEW',
  });
  if (existingPendingApp) {
    return res.status(409).json({
      error: 'APPLICATION_ALREADY_PENDING',
      message: 'An application for this domain is already pending review.',
    });
  }

  // 3a. Verify contact email verification token if provided
  let contactEmailVerified = false;
  if (contactEmailVerificationToken) {
    const verifiedContactPayload = verifyContactEmailVerificationToken(contactEmailVerificationToken);
    if (verifiedContactPayload && verifiedContactPayload.email === normalizedEmail) {
      contactEmailVerified = true;
    }
  }

  // 3b. Verify recovery email verification token if recovery email was provided
  let recoveryEmailVerified = false;
  if (recoveryEmail && recoveryEmailVerificationToken) {
    const verifiedPayload = verifyRecoveryEmailVerificationToken(recoveryEmailVerificationToken);
    if (verifiedPayload && verifiedPayload.email === normalizedRecoveryEmail) {
      recoveryEmailVerified = true;
    }
  }

  // 4. Verify TOTP setup token if provided
  let twoFactorEnabled = false;
  let twoFactorSecret: string | null = null;
  if (totpSetupToken) {
    const verifiedTotp = verifyTotpSetupToken(totpSetupToken);
    if (verifiedTotp && verifiedTotp.secret) {
      twoFactorEnabled = true;
      twoFactorSecret = verifiedTotp.secret;
    }
  }

  // 5. Hash initial password if provided
  let passwordHash: string | null = null;
  if (password) {
    passwordHash = await hashPassword(password);
  }

  // 6. Hash security questions if provided
  let processedSecurityQuestions: Array<{ question: string; answerHash: string }> = [];
  if (securityQuestions && securityQuestions.length === 3) {
    processedSecurityQuestions = securityQuestions.map((sq) => ({
      question: sq.question.trim(),
      answerHash: hashSecurityAnswer(sq.answer),
    }));
  }

  // 7. Create the registration application record
  const application = await RegistrationApplicationModel.create({
    companyName: companyName.trim(),
    requestedDomain: normalizedDomain,
    applicantName: resolvedApplicantName,
    firstName: firstName?.trim() || null,
    lastName: lastName?.trim() || null,
    contactEmail: normalizedEmail,
    contactEmailVerified,
    recoveryEmail: normalizedRecoveryEmail,
    recoveryEmailVerified,
    twoFactorEnabled,
    twoFactorSecret,
    securityQuestions: processedSecurityQuestions,
    phone: phone?.trim() || null,
    notes: notes?.trim() || null,
    employeeCount: employeeCount?.trim() || null,
    region: region?.trim() || null,
    passwordHash,
    status: 'PENDING_REVIEW',
  });

  // 4. Audit the public registration
  await AuditLogModel.create({
    actorRole: 'ANONYMOUS',
    actorEmail: normalizedEmail,
    actorIp: clientIp,
    action: 'TENANT_APPLICATION_SUBMITTED',
    resource: 'REGISTRATION_APPLICATION',
    resourceId: application._id.toString(),
    status: 'SUCCESS',
    metadata: {
      companyName: application.companyName,
      requestedDomain: application.requestedDomain,
    },
    timestamp: new Date(),
  });

  return res.status(201).json({
    success: true,
    message: 'Application submitted successfully. Our team will review your application.',
    application: {
      id: application._id.toString(),
      companyName: application.companyName,
      requestedDomain: application.requestedDomain,
      status: application.status,
      createdAt: application.createdAt,
    },
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

  // Check if organization has a pre-set registration password
  const application = await RegistrationApplicationModel.findOne({ requestedDomain: domain.domainName });

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
    hasRegistrationPassword: !!(application?.passwordHash),
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

  const domain = await DomainModel.findOne({ tenantId: tokenDoc.tenantId });
  const application = domain
    ? await RegistrationApplicationModel.findOne({
        $or: [
          { requestedDomain: domain.domainName.toLowerCase().trim() },
          { contactEmail: tokenDoc.contactEmail.toLowerCase().trim() },
        ],
      })
    : await RegistrationApplicationModel.findOne({ contactEmail: tokenDoc.contactEmail.toLowerCase().trim() });

  if (application?.passwordHash) {
    const isPasswordValid = await verifyPassword(application.passwordHash, password);
    if (!isPasswordValid) {
      return res.status(401).json({
        valid: false,
        error: 'INVALID_PASSWORD',
        message: 'The password entered does not match the password you set up during registration.',
      });
    }
  } else if (password.length < 8) {
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

  // Find linked application to verify registration password & transfer recovery profile
  const domain = await DomainModel.findOne({ tenantId: tenant._id });
  const application = domain
    ? await RegistrationApplicationModel.findOne({
        $or: [
          { requestedDomain: domain.domainName.toLowerCase().trim() },
          { contactEmail: tokenDoc.contactEmail.toLowerCase().trim() },
        ],
      })
    : await RegistrationApplicationModel.findOne({ contactEmail: tokenDoc.contactEmail.toLowerCase().trim() });

  // Enforce password verification against the password set during registration
  if (application?.passwordHash) {
    const isPasswordValid = await verifyPassword(application.passwordHash, password);
    if (!isPasswordValid) {
      return res.status(401).json({
        error: 'INVALID_PASSWORD',
        message: 'The password entered does not match the password you set up during registration.',
      });
    }
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Ensure no existing admin user with this email
  const existingUser = await AdminUserModel.findOne({ email: normalizedEmail });
  if (existingUser) {
    return res.status(409).json({ error: 'EMAIL_EXISTS', message: 'An admin user with this email already exists' });
  }

  // Use the verified registration password hash, or hash the provided password if no registration application exists
  const passwordHash = application?.passwordHash || (await hashPassword(password));

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
    recoveryEmail: application?.recoveryEmail || null,
    securityQuestions: application?.securityQuestions || [],
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

