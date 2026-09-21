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
import { activateDomain, retryVerify, checkDnsRecordsLive, DomainActivationError } from '../services/domain-activation.service';
import { emailService } from '../services/email.service';
import { config } from '../config';
import { suspendTenantInfrastructure, restoreTenantInfrastructure } from '../services/tenant-lifecycle.service';
import { forceDeleteOrganisation, OrganisationDeletionError } from '../services/organisation-deletion.service';
import { captureRequestContext } from '../services/request-context.service';
import { MailboxService } from '../services/mailbox.service';
import { isRegistrationEmailBlocked, REGISTRATION_EMAIL_BLOCKED_RESPONSE } from '../services/registration-block.service';
import { platformDeletionRouter } from './organisation-deletion.routes';

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
                dnsStatus: primaryDomain.dnsStatus,
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

// 1b. Get Single Tenant Full Details (Domains, Admins, Mailboxes, Audit Logs, Stats)
platformTenantRouter.get('/:id', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  try {
    const tenant = await TenantModel.findById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant not found' });
    }

    const [domains, admins, mailboxes, auditLogs] = await Promise.all([
      DomainModel.find({ tenantId: tenant._id }).sort({ isPrimary: -1, createdAt: 1 }),
      AdminUserModel.find({ tenantId: tenant._id, role: 'TENANT_ADMIN' }).sort({ createdAt: 1 }),
      MailboxModel.find({ tenantId: tenant._id }).sort({ createdAt: 1 }),
      AuditLogModel.find({ tenantId: tenant._id }).sort({ timestamp: -1 }).limit(50),
    ]);

    const activeMailboxes = mailboxes.filter((m) => m.status === 'active').length;
    const suspendedMailboxes = mailboxes.filter((m) => m.status === 'suspended').length;
    const activeDomains = domains.filter((d) => d.dnsStatus === 'active').length;
    const totalStorageBytes = mailboxes.reduce((acc, m) => acc + (m.storageBytes || 0), 0);

    return res.status(200).json({
      tenant: {
        id: tenant._id.toString(),
        name: tenant.name,
        status: tenant.status,
        mailboxLimit: tenant.mailboxLimit,
        mailboxCount: tenant.mailboxCount,
        createdAt: tenant.createdAt.toISOString(),
        updatedAt: tenant.updatedAt.toISOString(),
      },
      domains: domains.map((d) => ({
        id: d._id.toString(),
        domainName: d.domainName,
        stalwartDomainId: d.stalwartDomainId || null,
        status: d.status,
        isPrimary: d.isPrimary,
        mailboxLimit: d.mailboxLimit,
        employeeCount: d.employeeCount,
        dnsStatus: d.dnsStatus,
        planId: d.planId || null,
        planName: d.planName || null,
        createdAt: d.createdAt.toISOString(),
      })),
      admins: admins.map((a) => ({
        id: a._id.toString(),
        email: a.email,
        role: a.role,
        status: a.status,
        twoFactorEnabled: a.twoFactorEnabled,
        createdAt: a.createdAt.toISOString(),
      })),
      mailboxes: mailboxes.map((m) => ({
        id: m._id.toString(),
        address: m.address,
        localPart: m.localPart,
        domainId: m.domainId?.toString() || null,
        domainName: m.domainName,
        status: m.status,
        storageBytes: m.storageBytes || 0,
        createdAt: m.createdAt.toISOString(),
      })),
      auditLogs: auditLogs.map((l) => ({
        id: l._id.toString(),
        action: l.action,
        actorEmail: l.actorEmail,
        actorRole: l.actorRole,
        actorIp: l.actorIp,
        resource: l.resource,
        resourceId: l.resourceId,
        status: l.status,
        timestamp: l.timestamp.toISOString(),
        metadata: l.metadata,
      })),
      stats: {
        totalDomains: domains.length,
        activeDomains,
        totalMailboxes: mailboxes.length,
        activeMailboxes,
        suspendedMailboxes,
        totalStorageBytes,
        mailboxLimit: tenant.mailboxLimit,
        usagePercent: tenant.mailboxLimit > 0 ? Math.round((mailboxes.length / tenant.mailboxLimit) * 100) : 0,
      },
    });
  } catch (err: any) {
    console.error('[Get Tenant Error]:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve tenant details' });
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
      dnsZoneFile: result.dnsZoneFile || null,
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
      dnsZoneFile: result.dnsZoneFile || null,
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
    dnsZoneFile: domain.dnsZoneFile || null,
    dnsVerificationStartedAt: domain.dnsVerificationStartedAt,
    dnsVerifiedAt: domain.dnsVerifiedAt,
    activatedAt: domain.activatedAt,
  });
});

// 2f. Live DNS Records Readiness Check — a real public-DNS lookup for every
// required record, used to tell the Super Admin whether the tenant has
// actually finished their DNS setup BEFORE Activate is clicked, instead of
// only the stale dnsStatus left over from the last sweep/activation attempt.
platformTenantRouter.get('/:id/domains/:domainId/dns-check', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.domainId)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant or domain ID' });
  }

  const domain = await DomainModel.findOne({ _id: req.params.domainId, tenantId: req.params.id });
  if (!domain) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Domain not found for this tenant' });
  }

  try {
    const result = await checkDnsRecordsLive(domain.domainName, domain.dnsRecords || []);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[Domain DNS Check Error]:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to check DNS records.' });
  }
});

// 3. Suspend Tenant
platformTenantRouter.post('/:id/suspend', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  const tenant = await TenantModel.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant not found' });

  if (tenant.status === 'pending_deletion') {
    return res.status(409).json({
      error: 'DELETION_IN_PROGRESS',
      message: 'This organisation is in its deletion timeline. Cancel the deletion first.',
    });
  }

  tenant.status = 'suspended';
  await tenant.save();
  await suspendTenantInfrastructure(tenant._id);

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

  if (tenant.status === 'pending_deletion') {
    return res.status(409).json({
      error: 'DELETION_IN_PROGRESS',
      message: 'This organisation is in its deletion timeline. Cancel the deletion to restore it.',
    });
  }

  tenant.status = 'active';
  await tenant.save();
  await restoreTenantInfrastructure(tenant._id);

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

  if (await isRegistrationEmailBlocked(normalizedEmail, { ip: req.ip || 'unknown', source: 'platform-add-admin' })) {
    return res.status(403).json(REGISTRATION_EMAIL_BLOCKED_RESPONSE);
  }

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
  // An admin's login email is also their platform mailbox address, so the mail credential has to
  // move with it — otherwise login and IMAP/webmail drift apart.
  await MailboxService.syncLoginMailboxPassword(admin.email, parsed.data.newPassword);

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

// 9. Organisation deletion flow (request / name / OTPs / cancel / complete) for any tenant
platformTenantRouter.use('/:id/deletion', platformDeletionRouter);

// 10. Immediate ("forced") delete. Skips the security timeline, so it is Super-Admin-only, but it still
// writes the permanent Deleted Organisations record (actor, IP, device...) and blocks the registration email.
platformTenantRouter.delete('/:id', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  const tenant = await TenantModel.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant not found' });

  const tenantName = tenant.name;
  const domainNames = (await DomainModel.find({ tenantId: tenant._id })).map((d) => d.domainName);
  const mailboxesDeleted = await MailboxModel.countDocuments({ tenantId: tenant._id });

  try {
    const [admin, context] = await Promise.all([AdminUserModel.findById(req.adminUser!.id).select('name'), captureRequestContext(req)]);
    await forceDeleteOrganisation({
      tenantId: tenant._id.toString(),
      actor: { id: req.adminUser!.id, name: admin?.name ?? null, email: req.adminUser!.email, role: 'SUPER_ADMIN', tenantId: null },
      context,
      reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null,
    });
  } catch (err) {
    if (err instanceof OrganisationDeletionError) {
      return res.status(err.statusCode).json({ error: err.code, message: err.message });
    }
    throw err;
  }

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
      tenantName,
      domainName: domainNames[0],
      domainNames,
      mailboxesDeleted,
    },
    timestamp: new Date(),
  });

  return res.status(200).json({
    success: true,
    message: `Tenant "${tenantName}" and all associated mailboxes and domains have been permanently deleted.`,
  });
});
