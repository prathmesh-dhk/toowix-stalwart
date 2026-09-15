import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { requireSuperAdmin } from '../auth/middleware';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { AdminUserModel } from '../db/models/AdminUser';
import { RegistrationApplicationModel } from '../db/models/RegistrationApplication';
import { ActivationTokenModel } from '../db/models/ActivationToken';
import { AuditLogModel } from '../db/models/AuditLog';
import { MailboxModel } from '../db/models/Mailbox';
import { hashPassword } from '../auth/service';
import { stalwartClient } from '../stalwart/client';
import { activateDomain, retryVerify, DomainActivationError } from '../services/domain-activation.service';
import { emailService } from '../services/email.service';
import { config } from '../config';

export const platformTenantRouter = Router();

// All routes require Super Admin authentication
platformTenantRouter.use(requireSuperAdmin);

// 1. List All Tenants (with Domain, Admin Count, Usage)
platformTenantRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const tenants = await TenantModel.find().sort({ createdAt: -1 });

    const tenantSummaries = await Promise.all(
      tenants.map(async (t) => {
        const allDomains = await DomainModel.find({ tenantId: t._id }).sort({ isPrimary: -1, createdAt: 1 });

        // Stalwart domain creation happens only on explicit "Activate Domain"
        // (see domain-activation.service.ts) — never eagerly while listing.
        const primaryDomain = allDomains.find((d) => d.isPrimary) || allDomains[0] || null;
        const adminCount = await AdminUserModel.countDocuments({ tenantId: t._id });

        return {
          id: t._id.toString(),
          name: t.name,
          mailboxLimit: t.mailboxLimit,
          mailboxCount: t.mailboxCount,
          status: t.status,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
          domain: primaryDomain
            ? {
                id: primaryDomain._id.toString(),
                domainName: primaryDomain.domainName,
                stalwartDomainId: primaryDomain.stalwartDomainId || null,
                status: primaryDomain.status,
              }
            : null,
          domains: allDomains.map((d) => ({
            id: d._id.toString(),
            domainName: d.domainName,
            stalwartDomainId: d.stalwartDomainId || null,
            status: d.status,
            isPrimary: d.isPrimary,
            mailboxLimit: d.mailboxLimit,
            employeeCount: d.employeeCount,
            dnsStatus: d.dnsStatus,
          })),
          adminCount,
          availableMailboxes: Math.max(0, t.mailboxLimit - t.mailboxCount),
        };
      })
    );

    return res.status(200).json({ tenants: tenantSummaries });
  } catch (err: any) {
    console.error('[List Tenants Error]:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to list tenants' });
  }
});

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const createTenantSchema = z.object({
  name: z.string().min(2, 'Tenant name must be at least 2 characters').max(100),
  domain: z.string().min(3).refine((val) => DOMAIN_REGEX.test(val.trim().toLowerCase()), {
    message: 'Invalid domain format (e.g., example.com)',
  }),
  mailboxLimit: z.number().int().min(1, 'Mailbox limit must be at least 1').optional(),
});

// 2. Create Tenant Directly & Provision Domain in Stalwart
platformTenantRouter.post('/', async (req: Request, res: Response) => {
  const parseResult = createTenantSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { name, domain: rawDomain, mailboxLimit = 50 } = parseResult.data;
  const normalizedDomain = rawDomain.trim().toLowerCase();

  // Check if domain already claimed in MongoDB
  const existingDomain = await DomainModel.findOne({ domainName: normalizedDomain });
  if (existingDomain) {
    return res.status(409).json({
      error: 'DOMAIN_ALREADY_EXISTS',
      message: `Domain '${normalizedDomain}' is already claimed by another tenant`,
    });
  }

  // Stalwart domain creation and DNS provisioning happen only when a Super
  // Admin explicitly clicks "Activate Domain" later (see
  // domain-activation.service.ts) — not at tenant-creation time.
  const tenant = await TenantModel.create({
    name: name.trim(),
    status: 'active',
    mailboxLimit,
    mailboxCount: 0,
  });

  const domain = await DomainModel.create({
    tenantId: tenant._id,
    domainName: normalizedDomain,
    stalwartDomainId: null,
    status: 'active',
    dnsStatus: 'not_started',
    isPrimary: true,
  });

  await AuditLogModel.create({
    actorId: req.adminUser!.id,
    actorRole: req.adminUser!.role,
    actorEmail: req.adminUser!.email,
    actorIp: req.ip || req.socket.remoteAddress || 'unknown',
    tenantId: tenant._id,
    action: 'TENANT_CREATED',
    resource: 'TENANT',
    resourceId: tenant._id.toString(),
    status: 'SUCCESS',
    metadata: {
      tenantId: tenant._id.toString(),
      domainId: domain._id.toString(),
      name: tenant.name,
      domain: domain.domainName,
      mailboxLimit,
    },
    timestamp: new Date(),
  });

  return res.status(201).json({
    id: tenant._id.toString(),
    name: tenant.name,
    mailboxLimit: tenant.mailboxLimit,
    mailboxCount: tenant.mailboxCount,
    status: tenant.status,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
    domain: {
      id: domain._id.toString(),
      domainName: domain.domainName,
      stalwartDomainId: null,
      status: domain.status,
      dnsStatus: domain.dnsStatus,
    },
    adminCount: 0,
    availableMailboxes: tenant.mailboxLimit,
  });
});

// 3. Activate Tenant (domain already provisioned during approval)
platformTenantRouter.post('/:id/activate', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  const tenant = await TenantModel.findById(req.params.id);
  if (!tenant) {
    return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant not found' });
  }

  const domain = await DomainModel.findOne({ tenantId: tenant._id });
  if (!domain) {
    return res.status(400).json({ error: 'DOMAIN_NOT_FOUND', message: 'No domain bound to this tenant' });
  }

  // Activate Tenant & Domain
  tenant.status = 'active';
  await tenant.save();

  domain.status = 'active';
  await domain.save();

  // Find applicant contact email
  const application = await RegistrationApplicationModel.findOne({ requestedDomain: domain.domainName });
  const contactEmail = application?.contactEmail || `admin@${domain.domainName}`;

  // Generate 48-hour single-use activation token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await ActivationTokenModel.create({
    tenantId: tenant._id,
    tokenHash,
    contactEmail,
    expiresAt: new Date(Date.now() + 48 * 3600 * 1000), // 48 hours
  });

  const activationLink = `${config.tenantAdminUrl}/activate?token=${rawToken}`;

  // Send activation email to contact email
  const emailResult = await emailService.sendTenantActivationEmail({
    to: contactEmail,
    companyName: tenant.name,
    applicantName: application?.applicantName || tenant.name,
    domainName: domain.domainName,
    activationLink,
    expiresHours: 48,
  });

  // Audit log
  await AuditLogModel.create({
    actorId: req.adminUser!.id,
    actorRole: req.adminUser!.role,
    actorEmail: req.adminUser!.email,
    actorIp: req.ip || req.socket.remoteAddress || 'unknown',
    tenantId: tenant._id,
    action: 'TENANT_ACTIVATED',
    resource: 'TENANT',
    resourceId: tenant._id.toString(),
    status: 'SUCCESS',
    metadata: {
      domainName: domain.domainName,
      contactEmail,
      activationLink,
      emailSent: emailResult.success,
      emailError: emailResult.error,
    },
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    message: emailResult.success
      ? `Tenant "${tenant.name}" activated! Activation email sent to ${contactEmail}.`
      : `Tenant "${tenant.name}" activated! (Note: Email delivery failed: ${emailResult.error})`,
    activationLink,
    contactEmail,
    emailSent: emailResult.success,
    emailError: emailResult.error,
    tenant: {
      id: tenant._id.toString(),
      name: tenant.name,
      status: tenant.status,
      domain: domain.domainName,
    },
  });
});

// 2b. Resend Activation Email
platformTenantRouter.post('/:id/resend-activation', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  const tenant = await TenantModel.findById(req.params.id);
  if (!tenant) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Tenant not found' });
  }

  const domain = await DomainModel.findOne({ tenantId: tenant._id });
  if (!domain) {
    return res.status(404).json({ error: 'DOMAIN_NOT_FOUND', message: 'Tenant does not have an assigned domain' });
  }

  const application = await RegistrationApplicationModel.findOne({ requestedDomain: domain.domainName });
  const contactEmail = application?.contactEmail || `admin@${domain.domainName}`;

  // Invalidate any existing unused tokens for this tenant
  await ActivationTokenModel.deleteMany({ tenantId: tenant._id, usedAt: null });

  // Generate a fresh 48-hour activation token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await ActivationTokenModel.create({
    tenantId: tenant._id,
    tokenHash,
    contactEmail,
    expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
  });

  const activationLink = `${config.tenantAdminUrl}/activate?token=${rawToken}`;

  const emailResult = await emailService.sendTenantActivationEmail({
    to: contactEmail,
    companyName: tenant.name,
    applicantName: application?.applicantName || tenant.name,
    domainName: domain.domainName,
    activationLink,
    expiresHours: 48,
  });

  await AuditLogModel.create({
    actorId: req.adminUser!.id,
    actorRole: req.adminUser!.role,
    actorEmail: req.adminUser!.email,
    actorIp: req.ip || req.socket.remoteAddress || 'unknown',
    tenantId: tenant._id,
    action: 'TENANT_ACTIVATION_EMAIL_RESENT',
    resource: 'TENANT',
    resourceId: tenant._id.toString(),
    status: 'SUCCESS',
    metadata: {
      domainName: domain.domainName,
      contactEmail,
      activationLink,
      emailSent: emailResult.success,
      emailError: emailResult.error,
    },
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    message: emailResult.success
      ? `Activation email resent successfully to ${contactEmail}!`
      : `New activation link generated, but email delivery failed: ${emailResult.error}`,
    activationLink,
    contactEmail,
    emailSent: emailResult.success,
    emailError: emailResult.error,
  });
});

// 2c. Activate Domain (DNS/mail provisioning via Stalwart + GoDaddy — distinct
// from "/:id/activate" above, which only activates the Tenant Admin's login).
platformTenantRouter.post('/:id/domains/:domainId/activate', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.domainId)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant or domain ID' });
  }

  const domain = await DomainModel.findOne({ _id: req.params.domainId, tenantId: req.params.id });
  if (!domain) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Domain not found for this tenant' });
  }

  try {
    const result = await activateDomain(req.params.domainId, {
      id: req.adminUser!.id,
      email: req.adminUser!.email,
      role: req.adminUser!.role,
    });
    return res.status(200).json({
      success: true,
      dnsStatus: result.dnsStatus,
      dnsRecords: result.dnsRecords || [],
      dnsConflicts: result.dnsConflicts || [],
    });
  } catch (err: any) {
    if (err instanceof DomainActivationError) {
      return res.status(err.statusCode).json({ error: err.code, message: err.message });
    }
    console.error('[Domain Activation Error]:', err);
    return res.status(502).json({ error: 'DOMAIN_ACTIVATION_FAILED', message: err.message || 'Domain activation failed' });
  }
});

// 2d. Retry / Verify Domain Activation
platformTenantRouter.post('/:id/domains/:domainId/retry-verify', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.domainId)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant or domain ID' });
  }

  const domain = await DomainModel.findOne({ _id: req.params.domainId, tenantId: req.params.id });
  if (!domain) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Domain not found for this tenant' });
  }

  try {
    const result = await retryVerify(req.params.domainId, {
      id: req.adminUser!.id,
      email: req.adminUser!.email,
      role: req.adminUser!.role,
    });
    return res.status(200).json({
      success: true,
      dnsStatus: result.dnsStatus,
      dnsRecords: result.dnsRecords || [],
      dnsConflicts: result.dnsConflicts || [],
    });
  } catch (err: any) {
    if (err instanceof DomainActivationError) {
      return res.status(err.statusCode).json({ error: err.code, message: err.message });
    }
    console.error('[Domain Retry/Verify Error]:', err);
    return res.status(502).json({ error: 'DOMAIN_RETRY_FAILED', message: err.message || 'Domain retry/verify failed' });
  }
});

// 2e. Domain DNS Activation Status
platformTenantRouter.get('/:id/domains/:domainId/dns-status', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.domainId)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant or domain ID' });
  }

  const domain = await DomainModel.findOne({ _id: req.params.domainId, tenantId: req.params.id });
  if (!domain) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Domain not found for this tenant' });
  }

  return res.status(200).json({
    dnsStatus: domain.dnsStatus,
    dnsRecords: domain.dnsRecords || [],
    dnsConflicts: domain.dnsConflicts || [],
    dnsVerificationStartedAt: domain.dnsVerificationStartedAt,
    dnsVerifiedAt: domain.dnsVerifiedAt,
    activatedAt: domain.activatedAt,
  });
});

// 3. Suspend Tenant
platformTenantRouter.post('/:id/suspend', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  const tenant = await TenantModel.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant not found' });

  tenant.status = 'suspended';
  await tenant.save();

  const domain = await DomainModel.findOneAndUpdate(
    { tenantId: tenant._id },
    { status: 'suspended' },
    { returnDocument: 'after' }
  );

  // 1. Resolve Stalwart domain ID if missing, and disable domain
  let stalwartDomainId = domain?.stalwartDomainId;
  if (!stalwartDomainId && domain?.domainName) {
    try {
      const liveDomains = await stalwartClient.listDomains();
      const match = liveDomains.find((d) => d.name.toLowerCase() === domain.domainName.toLowerCase());
      if (match) {
        stalwartDomainId = match.id;
        domain.stalwartDomainId = match.id;
        await domain.save();
      }
    } catch (err: any) {
      console.warn(`[PlatformTenantRouter] Could not query Stalwart live domains for ${domain.domainName}:`, err.message);
    }
  }

  if (stalwartDomainId) {
    try {
      await stalwartClient.updateDomainStatus(stalwartDomainId, false);
    } catch (err: any) {
      console.warn(`[PlatformTenantRouter] Failed to disable Stalwart domain ${stalwartDomainId}:`, err.message);
    }
  }

  // 2. Cascade suspension to all mailboxes in MongoDB and freeze Stalwart accounts
  const mailboxes = await MailboxModel.find({ tenantId: tenant._id });
  await MailboxModel.updateMany({ tenantId: tenant._id }, { status: 'suspended' });

  let liveAccounts: any[] = [];
  try {
    liveAccounts = await stalwartClient.listAccounts();
  } catch (err: any) {
    console.warn('[PlatformTenantRouter] Could not list Stalwart accounts during suspend:', err.message);
  }

  for (const mailbox of mailboxes) {
    let accountId = mailbox.stalwartAccountId;
    if (!accountId) {
      const match = liveAccounts.find(
        (a) =>
          a.emailAddress?.toLowerCase() === mailbox.address.toLowerCase() ||
          (a.name?.toLowerCase() === mailbox.localPart.toLowerCase() && (!stalwartDomainId || a.domainId === stalwartDomainId))
      );
      if (match) {
        accountId = match.id;
        mailbox.stalwartAccountId = match.id;
        await mailbox.save();
      }
    }

    if (accountId) {
      try {
        await stalwartClient.updateAccountStatus(accountId, true);
      } catch (err: any) {
        console.warn(`[PlatformTenantRouter] Failed to freeze Stalwart account ${accountId} (${mailbox.address}):`, err.message);
      }
    }
  }

  await AuditLogModel.create({
    actorId: req.adminUser!.id,
    actorRole: req.adminUser!.role,
    actorEmail: req.adminUser!.email,
    actorIp: req.ip,
    tenantId: tenant._id,
    action: 'TENANT_SUSPENDED',
    resource: 'TENANT',
    resourceId: tenant._id.toString(),
    status: 'SUCCESS',
    timestamp: new Date(),
  });

  return res.status(200).json({ success: true, message: `Tenant "${tenant.name}" suspended.`, tenant });
});

// 4. Reactivate Tenant
platformTenantRouter.post('/:id/reactivate', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  const tenant = await TenantModel.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant not found' });

  tenant.status = 'active';
  await tenant.save();

  const domain = await DomainModel.findOneAndUpdate(
    { tenantId: tenant._id },
    { status: 'active' },
    { returnDocument: 'after' }
  );

  // 1. Resolve Stalwart domain ID if missing, and re-enable domain
  let stalwartDomainId = domain?.stalwartDomainId;
  if (!stalwartDomainId && domain?.domainName) {
    try {
      const liveDomains = await stalwartClient.listDomains();
      const match = liveDomains.find((d) => d.name.toLowerCase() === domain.domainName.toLowerCase());
      if (match) {
        stalwartDomainId = match.id;
        domain.stalwartDomainId = match.id;
        await domain.save();
      }
    } catch (err: any) {
      console.warn(`[PlatformTenantRouter] Could not query Stalwart live domains for ${domain.domainName}:`, err.message);
    }
  }

  if (stalwartDomainId) {
    try {
      await stalwartClient.updateDomainStatus(stalwartDomainId, true);
    } catch (err: any) {
      console.warn(`[PlatformTenantRouter] Failed to enable Stalwart domain ${stalwartDomainId}:`, err.message);
    }
  }

  // 2. Restore mailboxes in MongoDB and unfreeze Stalwart accounts
  const mailboxes = await MailboxModel.find({ tenantId: tenant._id });
  await MailboxModel.updateMany({ tenantId: tenant._id }, { status: 'active' });

  for (const mailbox of mailboxes) {
    if (mailbox.stalwartAccountId) {
      try {
        await stalwartClient.updateAccountStatus(mailbox.stalwartAccountId, false);
      } catch (err: any) {
        console.warn(`[PlatformTenantRouter] Failed to unfreeze Stalwart account ${mailbox.stalwartAccountId} (${mailbox.address}):`, err.message);
      }
    }
  }

  await AuditLogModel.create({
    actorId: req.adminUser!.id,
    actorRole: req.adminUser!.role,
    actorEmail: req.adminUser!.email,
    actorIp: req.ip,
    tenantId: tenant._id,
    action: 'TENANT_REACTIVATED',
    resource: 'TENANT',
    resourceId: tenant._id.toString(),
    status: 'SUCCESS',
    timestamp: new Date(),
  });

  return res.status(200).json({ success: true, message: `Tenant "${tenant.name}" reactivated.`, tenant });
});

// 5. Update Mailbox Quota Limit
const quotaSchema = z.object({
  mailboxLimit: z.number().int().min(1, 'Quota must be at least 1'),
});

platformTenantRouter.patch('/:id/mailbox-limit', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  const parseResult = quotaSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const { mailboxLimit } = parseResult.data;
  const tenant = await TenantModel.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant not found' });

  if (mailboxLimit < tenant.mailboxCount) {
    return res.status(400).json({
      error: 'QUOTA_BELOW_USAGE',
      message: `Cannot lower quota to ${mailboxLimit} because tenant is currently using ${tenant.mailboxCount} mailboxes.`,
    });
  }

  tenant.mailboxLimit = mailboxLimit;
  await tenant.save();

  return res.status(200).json({ success: true, tenant });
});

// 6. List Tenant Admins
platformTenantRouter.get('/:id/admins', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  const tenant = await TenantModel.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant not found' });

  const admins = await AdminUserModel.find({ tenantId: tenant._id, role: 'TENANT_ADMIN' }).sort({ createdAt: 1 });

  return res.status(200).json({
    admins: admins.map((a) => ({
      id: a._id.toString(),
      email: a.email,
      role: a.role,
      status: a.status,
      twoFactorEnabled: a.twoFactorEnabled,
      createdAt: a.createdAt.toISOString(),
    })),
  });
});

// 7. Create Tenant Admin
const createAdminSchema = z.object({
  email: z.string().email('Invalid email address format'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
});

platformTenantRouter.post('/:id/admins', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  const tenant = await TenantModel.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant not found' });

  const parsed = createAdminSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.errors });
  }

  const normalizedEmail = parsed.data.email.toLowerCase().trim();
  const existing = await AdminUserModel.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({
      error: 'ADMIN_EXISTS',
      message: `Admin with email "${normalizedEmail}" already exists`,
    });
  }

  const passwordHash = await hashPassword(parsed.data.password);

  const admin = await AdminUserModel.create({
    email: normalizedEmail,
    passwordHash,
    role: 'TENANT_ADMIN',
    tenantId: tenant._id,
    status: 'active',
    twoFactorEnabled: false,
  });

  await AuditLogModel.create({
    actorId: req.adminUser!.id,
    actorRole: req.adminUser!.role,
    actorEmail: req.adminUser!.email,
    actorIp: req.ip,
    tenantId: tenant._id,
    action: 'TENANT_ADMIN_CREATED',
    resource: 'ADMIN_USER',
    resourceId: admin._id.toString(),
    status: 'SUCCESS',
    metadata: { email: admin.email, tenantName: tenant.name },
    timestamp: new Date(),
  });

  return res.status(201).json({
    admin: {
      id: admin._id.toString(),
      email: admin.email,
      role: admin.role,
      status: admin.status,
      twoFactorEnabled: admin.twoFactorEnabled,
      createdAt: admin.createdAt.toISOString(),
    },
  });
});

// 8. Reset Tenant Admin Password
const resetAdminPassSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters long'),
});

platformTenantRouter.post('/:id/admins/:adminId/reset-password', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.adminId)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed ID parameter' });
  }

  const parsed = resetAdminPassSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.errors });
  }

  const admin = await AdminUserModel.findOne({ _id: req.params.adminId, tenantId: req.params.id });
  if (!admin) {
    return res.status(404).json({ error: 'ADMIN_NOT_FOUND', message: 'Tenant Admin not found' });
  }

  admin.passwordHash = await hashPassword(parsed.data.newPassword);
  await admin.save();

  await AuditLogModel.create({
    actorId: req.adminUser!.id,
    actorRole: req.adminUser!.role,
    actorEmail: req.adminUser!.email,
    actorIp: req.ip,
    tenantId: admin.tenantId,
    action: 'TENANT_ADMIN_PASSWORD_RESET',
    resource: 'ADMIN_USER',
    resourceId: admin._id.toString(),
    status: 'SUCCESS',
    metadata: { email: admin.email },
    timestamp: new Date(),
  });

  return res.status(200).json({ message: 'Password successfully reset' });
});

// 9. Cascade Delete Tenant
platformTenantRouter.delete('/:id', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  const tenant = await TenantModel.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant not found' });

  // 1. Delete all Stalwart mailbox accounts
  const mailboxes = await MailboxModel.find({ tenantId: tenant._id });
  for (const m of mailboxes) {
    if (m.stalwartAccountId) {
      try {
        await stalwartClient.deleteAccount(m.stalwartAccountId);
      } catch (err: any) {
        console.warn(`[Cascade Delete] Failed to delete Stalwart account ${m.stalwartAccountId}:`, err.message);
      }
    }
  }

  // 2. Delete Stalwart domain and linked DKIM signatures
  const domain = await DomainModel.findOne({ tenantId: tenant._id });
  if (domain) {
    let domainIdToDelete = domain.stalwartDomainId;
    if (!domainIdToDelete) {
      try {
        const liveDomains = await stalwartClient.listDomains();
        const match = liveDomains.find((d) => d.name.toLowerCase() === domain.domainName.toLowerCase());
        if (match) domainIdToDelete = match.id;
      } catch {
        // ignore list failure
      }
    }
    if (domainIdToDelete) {
      try {
        await stalwartClient.deleteDomain(domainIdToDelete);
      } catch (err: any) {
        console.warn(`[Cascade Delete] Failed to delete Stalwart domain ${domainIdToDelete}:`, err.message);
      }
    }
  }

  // 3. Purge all related MongoDB records
  await MailboxModel.deleteMany({ tenantId: tenant._id });
  await DomainModel.deleteMany({ tenantId: tenant._id });
  await AdminUserModel.deleteMany({ tenantId: tenant._id });
  await ActivationTokenModel.deleteMany({ tenantId: tenant._id });
  await TenantModel.deleteOne({ _id: tenant._id });

  // 4. Audit deletion
  await AuditLogModel.create({
    actorId: req.adminUser!.id,
    actorRole: req.adminUser!.role,
    actorEmail: req.adminUser!.email,
    actorIp: req.ip,
    tenantId: tenant._id,
    action: 'TENANT_DELETED',
    resource: 'TENANT',
    resourceId: tenant._id.toString(),
    status: 'SUCCESS',
    metadata: {
      tenantName: tenant.name,
      domainName: domain?.domainName,
      mailboxesDeleted: mailboxes.length,
    },
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    message: `Tenant "${tenant.name}" and all associated mailboxes and domains have been permanently deleted.`,
  });
});
