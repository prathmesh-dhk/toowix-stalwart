import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { requireSuperAdmin } from '../auth/middleware';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { AdminUserModel } from '../db/models/AdminUser';
import { ActivationTokenModel } from '../db/models/ActivationToken';
import { AuditLogModel } from '../db/models/AuditLog';
import { MailboxModel } from '../db/models/Mailbox';
import { hashPassword } from '../auth/service';
import { checkDnsRecordsLive } from '../services/domain-activation.service';
import { emailService } from '../services/email.service';
import { config } from '../config';
import { suspendTenantInfrastructure, restoreTenantInfrastructure } from '../services/tenant-lifecycle.service';
import { forceDeleteOrganisation, OrganisationDeletionError } from '../services/organisation-deletion.service';
import { deleteDomainDirectly, DomainDeletionError } from '../services/domain-deletion.service';
import { activateDomain, DomainActivationError } from '../services/domain-activation.service';
import { stalwartClient } from '../stalwart/client';
import { captureRequestContext } from '../services/request-context.service';
import { MailboxService } from '../services/mailbox.service';
import { isRegistrationEmailBlocked, REGISTRATION_EMAIL_BLOCKED_RESPONSE } from '../services/registration-block.service';
import { platformDeletionRouter } from './organisation-deletion.routes';
import { getTenantBillingSummary, listTenantInvoices } from '../services/billing.service';
import { DomainSubscriptionModel, DomainSubscriptionStatus } from '../db/models/DomainSubscription';
import { stripeClient } from '../stripe/client';
import { isValidMailDomain } from '../utils/domain-validator';

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

// 1a. Unmanaged Stalwart Domains — domains that exist in Stalwart but have no Domain record here
// at all (created directly against Stalwart, or left behind by a deleted tenant). Lets a Super
// Admin discover them and pick one to attach to a new or existing tenant, instead of having to
// already know the exact domain name. Adoption itself needs no new logic: creating a Domain
// record for one of these and then activating the tenant already recognizes an existing Stalwart
// domain via the StalwartDomainExistsError → listDomains() fallback in activateDomain()/retryVerify().
platformTenantRouter.get('/unmanaged-domains', async (req: Request, res: Response) => {
  try {
    const [stalwartDomains, trackedDomains] = await Promise.all([
      stalwartClient.listDomains(),
      DomainModel.find({}, { domainName: 1 }),
    ]);
    const tracked = new Set(trackedDomains.map((d) => d.domainName.toLowerCase()));

    let unmanaged = stalwartDomains
      .filter((d) => !tracked.has(d.name.toLowerCase()))
      .map((d) => ({ stalwartDomainId: d.id, domainName: d.name, isEnabled: d.isEnabled }));

    // Optional search by domain name substring (case-insensitive)
    const q = req.query.q;
    if (typeof q === 'string' && q.trim() !== '') {
      const query = q.trim().toLowerCase();
      unmanaged = unmanaged.filter((d) => d.domainName.toLowerCase().includes(query));
    }

    // Return only domain name and stalwartDomainId per spec (no extra metadata)
    const result = unmanaged.map((d) => ({
      domainName: d.domainName,
      stalwartDomainId: d.stalwartDomainId,
    }));

    return res.status(200).json({ domains: result });
  } catch (err: any) {
    console.error('[Unmanaged Domains Error]:', err);
    return res.status(502).json({ error: 'STALWART_UNAVAILABLE', message: err.message || 'Failed to list Stalwart domains' });
  }
});

// Loaded by the Billing tab on its own, so a Stripe failure only breaks the invoice list.
platformTenantRouter.get('/:id/invoices', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }
  try {
    return res.status(200).json({ invoices: await listTenantInvoices(req.params.id) });
  } catch (err: any) {
    console.error('[Tenant Invoices Error]:', err);
    return res.status(502).json({ error: 'STRIPE_UNAVAILABLE', message: err.message || 'Failed to list invoices' });
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
      AdminUserModel.find({ tenantId: tenant._id, role: { $in: ['TENANT_ADMIN', 'TENANT_MODERATOR'] } }).sort({ createdAt: 1 }),
      MailboxModel.find({ tenantId: tenant._id }).sort({ createdAt: 1 }),
      AuditLogModel.find({ tenantId: tenant._id }).sort({ timestamp: -1 }).limit(50),
    ]);

    const activeMailboxes = mailboxes.filter((m) => m.status === 'active').length;
    const suspendedMailboxes = mailboxes.filter((m) => m.status === 'suspended').length;
    const activeDomains = domains.filter((d) => d.dnsStatus === 'active').length;
    const totalStorageBytes = mailboxes.reduce((acc, m) => acc + (m.storageBytes || 0), 0);

    // Billing summary is read-only here (reuses the same tenant-facing helper);
    // never let a Stripe/billing hiccup break the whole detail page.
    let billing: Awaited<ReturnType<typeof getTenantBillingSummary>> | null = null;
    try {
      billing = await getTenantBillingSummary(tenant._id.toString());
    } catch (err) {
      console.error('[Get Tenant Error] billing summary failed:', err);
    }

    return res.status(200).json({
      tenant: {
        id: tenant._id.toString(),
        name: tenant.name,
        status: tenant.status,
        mailboxLimit: tenant.mailboxLimit,
        mailboxCount: tenant.mailboxCount,
        createdAt: tenant.createdAt.toISOString(),
        updatedAt: tenant.updatedAt.toISOString(),
        operatorNotes: tenant.operatorNotes || '',
        stripeCustomerId: tenant.stripeCustomerId || null,
        stripeSubscriptionId: tenant.stripeSubscriptionId || null,
      },
      billing,
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
  domain: z.string().min(3).refine((val) => isValidMailDomain(val), {
    message: 'Invalid domain format (requires a valid public domain, e.g. example.com)',
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

  // Actually provision the domain in Stalwart (create it, enable DKIM, enable it) — this used to
  // be a promise the code never kept: it only flipped Mongo's `status` field and never touched
  // Stalwart, so a Super-Admin-created domain would sit "active" in the platform with no mail
  // routing at all. `activateDomain` already knows how to run in "manual mode" (no DNS provider
  // connected), which is exactly this path. Non-fatal like the email send below: a Stalwart hiccup
  // here shouldn't block the tenant record from being marked active, but it IS reported back.
  let stalwartProvisionError: string | null = null;
  try {
    await activateDomain(domain._id.toString(), {
      id: req.adminUser!.id,
      role: req.adminUser!.role,
      email: req.adminUser!.email,
    });
  } catch (err: any) {
    if (!(err instanceof DomainActivationError && err.code === 'ALREADY_ACTIVE')) {
      stalwartProvisionError = err.message || 'Failed to provision domain in Stalwart';
      console.error('[Activate Tenant] Stalwart provisioning failed:', err);
    }
  }

  const contactEmail = tenant.contactEmail || `admin@${domain.domainName}`;

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
    applicantName: tenant.name,
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
      stalwartProvisionError,
    },
    timestamp: new Date(),
  });

  const messageParts = [`Tenant "${tenant.name}" activated!`];
  messageParts.push(emailResult.success ? `Activation email sent to ${contactEmail}.` : `(Note: Email delivery failed: ${emailResult.error})`);
  if (stalwartProvisionError) {
    messageParts.push(`WARNING: domain was not provisioned in Stalwart (${stalwartProvisionError}) — mail will not work until this is retried.`);
  }

  return res.status(200).json({
    success: true,
    message: messageParts.join(' '),
    activationLink,
    contactEmail,
    emailSent: emailResult.success,
    emailError: emailResult.error,
    stalwartProvisionError,
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

  const contactEmail = tenant.contactEmail || `admin@${domain.domainName}`;

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
    applicantName: tenant.name,
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

// 2c. Domain DNS activation status
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

// 2g. Delete Domain from Tenant (Super Admin action)
platformTenantRouter.delete('/:id/domains/:domainId', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.domainId)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant or domain ID' });
  }

  const actor = {
    id: req.adminUser!.id,
    email: req.adminUser!.email,
    role: req.adminUser!.role,
  };

  try {
    const result = await deleteDomainDirectly(req.params.domainId, req.params.id, actor);
    return res.status(200).json(result);
  } catch (err: any) {
    if (err instanceof DomainDeletionError) {
      return res.status(err.statusCode).json({ error: err.code, message: err.message });
    }
    console.error('[Platform Domain Delete Error]:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to delete domain.' });
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

// 5b. Update Operator Notes (Super Admin only, free-text support/escalation context)
const notesSchema = z.object({ notes: z.string().max(10000).optional().default('') });

platformTenantRouter.patch('/:id/notes', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  const parseResult = notesSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.errors });
  }

  const tenant = await TenantModel.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant not found' });

  tenant.operatorNotes = parseResult.data.notes;
  await tenant.save();

  await AuditLogModel.create({
    actorId: req.adminUser!.id,
    actorRole: req.adminUser!.role,
    actorEmail: req.adminUser!.email,
    actorIp: req.ip,
    tenantId: tenant._id,
    action: 'TENANT_NOTES_UPDATED',
    resource: 'TENANT',
    resourceId: tenant._id.toString(),
    status: 'SUCCESS',
    timestamp: new Date(),
  });

  return res.status(200).json({ success: true, operatorNotes: tenant.operatorNotes });
});

// 5c. Sync Tenant Subscription With Stripe (pulls current status/items straight from Stripe;
// real read-through, not a fabricated success — no-op when the tenant has no subscription yet)
platformTenantRouter.post('/:id/sync-stripe', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  const tenant = await TenantModel.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant not found' });

  if (!tenant.stripeSubscriptionId) {
    return res.status(200).json({ success: true, synced: false, message: 'No Stripe subscription on this tenant yet.' });
  }

  try {
    const sub = await stripeClient.retrieveSubscriptionExpanded(tenant.stripeSubscriptionId);
    // Stripe's status vocabulary is a superset of ours (unpaid/paused/incomplete_expired have no
    // local equivalent yet) — map what we recognize, leave the row's status alone otherwise.
    const statusMap: Partial<Record<string, DomainSubscriptionStatus>> = {
      trialing: 'trialing',
      active: 'active',
      past_due: 'past_due',
      canceled: 'canceled',
      incomplete: 'incomplete',
    };
    const mappedStatus = statusMap[sub.status];

    for (const item of sub.items.data) {
      const domainId = item.price?.product && typeof item.price.product === 'object' ? (item.price.product as any).metadata?.domainId : undefined;
      if (!domainId) continue;
      const update: Record<string, unknown> = { stripeSubscriptionItemId: item.id };
      if (mappedStatus) update.status = mappedStatus;
      await DomainSubscriptionModel.updateOne({ tenantId: tenant._id, domainId }, { $set: update });
    }

    await AuditLogModel.create({
      actorId: req.adminUser!.id,
      actorRole: req.adminUser!.role,
      actorEmail: req.adminUser!.email,
      actorIp: req.ip,
      tenantId: tenant._id,
      action: 'TENANT_STRIPE_SYNCED',
      resource: 'TENANT',
      resourceId: tenant._id.toString(),
      status: 'SUCCESS',
      timestamp: new Date(),
      metadata: { stripeStatus: sub.status },
    });

    return res.status(200).json({ success: true, synced: true, stripeStatus: sub.status });
  } catch (err: any) {
    console.error('[Sync Tenant Stripe Error]:', err);
    return res.status(502).json({ error: 'STRIPE_SYNC_FAILED', message: err.message || 'Failed to sync with Stripe' });
  }
});

// 6. List Tenant Admins
platformTenantRouter.get('/:id/admins', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  const tenant = await TenantModel.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant not found' });

  const admins = await AdminUserModel.find({ tenantId: tenant._id, role: { $in: ['TENANT_ADMIN', 'TENANT_MODERATOR'] } }).sort({ createdAt: 1 });

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

  // Deliberately TENANT_ADMIN-only: Moderator accounts are visible here (the /:id and /:id/admins
  // routes above list both roles), but managing them — including password resets — stays with the
  // Tenant Admin, same as creating/editing/removing one. Widening the list to include Moderators
  // must not implicitly widen this action too.
  const admin = await AdminUserModel.findOne({ _id: req.params.adminId, tenantId: req.params.id, role: 'TENANT_ADMIN' });
  if (!admin) {
    return res.status(404).json({ error: 'ADMIN_NOT_FOUND', message: 'Tenant Admin not found' });
  }

  // 1. Sync & validate with Stalwart first if account has a mailbox.
  try {
    await MailboxService.syncLoginMailboxPassword(admin.email, parsed.data.newPassword);
  } catch (err: any) {
    return res.status(err.status || 400).json({
      error: err.code || 'PASSWORD_REJECTED',
      message: err.message || 'Password was rejected by the mail engine',
    });
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

// 9. Organisation deletion flow (request / name / OTPs / cancel / complete) for any tenant
platformTenantRouter.use('/:id/deletion', platformDeletionRouter);

// 9. Import pre-existing Stalwart domains and mailboxes for a tenant
platformTenantRouter.post('/:id/domains/import', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: 'Malformed tenant ID' });
  }

  const tenant = await TenantModel.findById(req.params.id);
  if (!tenant) {
    return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant not found' });
  }

  const { domainIds } = req.body as { domainIds?: string[] };
  if (!domainIds || !Array.isArray(domainIds) || domainIds.length === 0) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'domainIds array is required' });
  }

  const results: {
    success: Array<{ domainName: string; stalwartDomainId: string; mailboxesImported: number }>;
    errors: Array<{ domainName: string; message: string }>;
  } = { success: [], errors: [] };

  let totalMailboxesImported = 0;

  for (const stalwartDomainId of domainIds) {
    try {
      // Fetch domain info from Stalwart
      const domain = await stalwartClient.getDomain(stalwartDomainId);
      if (!domain) {
        results.errors.push({ domainName: stalwartDomainId, message: 'Domain not found on Stalwart' });
        continue;
      }

      const normalizedDomainName = domain.name.toLowerCase().trim();

      // Check if already claimed by any tenant (case-insensitive)
      const existing = await DomainModel.findOne({
        domainName: { $regex: new RegExp(`^${normalizedDomainName}$`, 'i') },
      });
      if (existing) {
        results.errors.push({ domainName: domain.name, message: 'Domain already claimed by a tenant' });
        continue;
      }

      // First imported domain becomes primary if tenant currently has 0 domains
      const existingDomainCount = await DomainModel.countDocuments({ tenantId: tenant._id });
      const isPrimary = existingDomainCount === 0;

      // Extract DKIM info from Stalwart if generated
      let dkimSelector: string | null = null;
      let dkimPublicKey: string | null = null;
      try {
        const dkimKeys = await stalwartClient.getActiveDkimKeys(domain.id);
        if (dkimKeys && dkimKeys.length > 0) {
          dkimSelector = dkimKeys[0].selector || null;
          dkimPublicKey = dkimKeys[0].publicKey || null;
        }
      } catch (err: any) {
        // Non-blocking
      }

      // Create local Domain record
      const domainDoc = await DomainModel.create({
        tenantId: tenant._id,
        domainName: normalizedDomainName,
        stalwartDomainId: domain.id,
        status: domain.isEnabled ? 'active' : 'suspended',
        dnsStatus: 'not_started',
        isPrimary,
        dnsZoneFile: domain.dnsZoneFile || null,
        dkimSelector,
        dkimPublicKey,
      });

      // Import mailboxes for this domain
      const accounts = await stalwartClient.listAccounts();
      const domainAccounts = accounts.filter(
        (acc) =>
          acc.domainId === domain.id ||
          (acc.emailAddress && acc.emailAddress.toLowerCase().endsWith(`@${normalizedDomainName}`))
      );
      let importedMailboxes = 0;

      for (const acc of domainAccounts) {
        const localPart = (acc.name || '').toLowerCase().trim();
        const fullAddress = (
          acc.emailAddress || `${localPart}@${normalizedDomainName}`
        ).toLowerCase().trim();

        if (!localPart || !fullAddress) continue;

        // Check if mailbox already claimed globally or locally within tenant
        const existingMailbox = await MailboxModel.findOne({
          $or: [
            { address: { $regex: new RegExp(`^${fullAddress}$`, 'i') } },
            { tenantId: tenant._id, localPart },
          ],
        });
        if (existingMailbox) {
          continue; // skip, already claimed
        }

        // Create mailbox record (password preserved on Stalwart server per spec)
        await MailboxModel.create({
          tenantId: tenant._id,
          domainId: domainDoc._id,
          domainName: normalizedDomainName,
          localPart,
          address: fullAddress,
          displayName: acc.description || acc.name || null,
          stalwartAccountId: acc.id,
          status: 'active',
          billingHold: false,
        });
        importedMailboxes++;
      }

      totalMailboxesImported += importedMailboxes;

      // Ensure domain-level mailbox limit accommodates imported mailboxes
      if (importedMailboxes > domainDoc.mailboxLimit) {
        await DomainModel.updateOne(
          { _id: domainDoc._id },
          { $set: { mailboxLimit: importedMailboxes } }
        );
      }

      // Audit log entry for domain import
      if (req.adminUser) {
        await AuditLogModel.create({
          actorId: req.adminUser.id,
          actorRole: req.adminUser.role,
          actorEmail: req.adminUser.email,
          actorIp: req.ip || req.socket.remoteAddress || 'unknown',
          tenantId: tenant._id,
          action: 'DOMAIN_IMPORTED',
          resource: 'DOMAIN',
          resourceId: domainDoc._id.toString(),
          status: 'SUCCESS',
          metadata: {
            domainName: normalizedDomainName,
            stalwartDomainId: domain.id,
            mailboxesImported: importedMailboxes,
            isPrimary,
          },
          timestamp: new Date(),
        });
      }

      results.success.push({
        domainName: domain.name,
        stalwartDomainId: domain.id,
        mailboxesImported: importedMailboxes,
      });
    } catch (err: any) {
      results.errors.push({
        domainName: stalwartDomainId,
        message: err.message || 'Unknown error',
      });
    }
  }

  // Synchronize tenant mailbox count and ensure quota limit accommodates all imported mailboxes
  if (totalMailboxesImported > 0) {
    const freshTenant = await TenantModel.findById(tenant._id);
    const currentCount = freshTenant?.mailboxCount || 0;
    const currentLimit = freshTenant?.mailboxLimit || 10;
    const newCount = currentCount + totalMailboxesImported;
    const newLimit = Math.max(currentLimit, newCount);

    await TenantModel.updateOne(
      { _id: tenant._id },
      {
        $inc: { mailboxCount: totalMailboxesImported },
        $set: { mailboxLimit: newLimit },
      }
    );
  }

  if (results.errors.length > 0 && results.success.length === 0) {
    return res.status(400).json({ error: 'IMPORT_FAILED', details: results });
  }

  return res.status(200).json(results);
});

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
