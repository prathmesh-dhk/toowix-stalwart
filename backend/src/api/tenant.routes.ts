import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireTenantAdmin } from '../auth/middleware';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { AdminUserModel } from '../db/models/AdminUser';
import { MailboxModel } from '../db/models/Mailbox';
import { AuditLogModel } from '../db/models/AuditLog';
import { connectGoDaddyCredential, DomainActivationError } from '../services/domain-activation.service';
import { GoDaddyAuthError, GoDaddyDomainNotManagedError } from '../godaddy/errors';
import { stalwartClient } from '../stalwart/client';

export const tenantMeRouter = Router();

// ==========================================
// TENANT ADMIN SELF ROUTE (/api/tenants/me)
// ==========================================

tenantMeRouter.use(requireTenantAdmin);

tenantMeRouter.get('/me', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser?.tenantId;

  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant ID is missing or malformed' });
    return;
  }

  try {
    const tenant = await TenantModel.findById(tenantId);
    if (!tenant) {
      res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant record not found' });
      return;
    }

    const domains = await DomainModel.find({ tenantId: tenant._id }).sort({ createdAt: 1 });
    const adminCount = await AdminUserModel.countDocuments({ tenantId: tenant._id });

    // Aggregate mailbox count per domain
    const mailboxCounts = await MailboxModel.aggregate([
      { $match: { tenantId: tenant._id } },
      { $group: { _id: '$domainId', count: { $sum: 1 } } },
    ]);
    const countsMap = new Map(mailboxCounts.map((m) => [m._id.toString(), m.count]));

    const mappedDomains = domains.map((d) => {
      const mbCount = countsMap.get(d._id.toString()) || 0;
      return {
        id: d._id.toString(),
        domainName: d.domainName,
        stalwartDomainId: d.stalwartDomainId || null,
        status: d.status,
        mailboxLimit: d.mailboxLimit || 10,
        employeeCount: d.employeeCount || d.mailboxLimit || 10,
        mailboxCount: mbCount,
        isPrimary: !!d.isPrimary,
        createdAt: d.createdAt.toISOString(),
      };
    });

    const primaryDomain = mappedDomains.find((d) => d.isPrimary) || mappedDomains[0] || null;

    res.status(200).json({
      tenant: {
        id: tenant._id.toString(),
        name: tenant.name,
        status: tenant.status,
        mailboxLimit: tenant.mailboxLimit,
        mailboxCount: tenant.mailboxCount,
        availableMailboxes: Math.max(0, tenant.mailboxLimit - tenant.mailboxCount),
        adminCount,
        createdAt: tenant.createdAt.toISOString(),
        updatedAt: tenant.updatedAt.toISOString(),
        domain: primaryDomain, // Backwards compatibility
        domains: mappedDomains,
      },
    });
  } catch (err: any) {
    console.error('[TenantMe Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve tenant context' });
  }
});

// ==========================================
// LIST ALL DOMAINS (/api/tenants/me/domains or /api/tenants/domains)
// ==========================================
tenantMeRouter.get(['/me/domains', '/domains'], async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser?.tenantId;
  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant ID is missing or malformed' });
    return;
  }

  try {
    const domains = await DomainModel.find({ tenantId }).sort({ createdAt: 1 });

    // Stalwart domain creation happens only on explicit "Activate Domain"
    // (see domain-activation.service.ts) — never eagerly while listing.
    const mailboxCounts = await MailboxModel.aggregate([
      { $match: { tenantId: new mongoose.Types.ObjectId(tenantId) } },
      { $group: { _id: '$domainId', count: { $sum: 1 } } },
    ]);
    const countsMap = new Map(mailboxCounts.map((m) => [m._id.toString(), m.count]));

    const mappedDomains = domains.map((d) => ({
      id: d._id.toString(),
      domainName: d.domainName,
      stalwartDomainId: d.stalwartDomainId || null,
      status: d.status,
      mailboxLimit: d.mailboxLimit || 10,
      employeeCount: d.employeeCount || d.mailboxLimit || 10,
      mailboxCount: countsMap.get(d._id.toString()) || 0,
      isPrimary: !!d.isPrimary,
      createdAt: d.createdAt.toISOString(),
    }));

    res.status(200).json({ domains: mappedDomains });
  } catch (err: any) {
    console.error('[Tenant Domains List Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve domains' });
  }
});

// ==========================================
// ADD NEW DOMAIN (/api/tenants/me/domains)
// ==========================================
const addDomainSchema = z.object({
  domainName: z
    .string()
    .min(3, 'Domain name is required')
    .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i, 'Invalid domain format'),
  employeeTier: z
    .number()
    .refine((v) => [1, 10, 25, 50, 75, 100].includes(v), {
      message: 'Employee tier must be one of: 1, 10, 25, 50, 75, 100',
    })
    .default(10),
});

tenantMeRouter.post(['/me/domains', '/domains'], async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser?.tenantId;
  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant ID is missing or malformed' });
    return;
  }

  const parseResult = addDomainSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.flatten().fieldErrors });
    return;
  }

  const { domainName, employeeTier } = parseResult.data;
  const normalizedDomain = domainName.toLowerCase().trim();

  try {
    const tenant = await TenantModel.findById(tenantId);
    if (!tenant) {
      res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant record not found' });
      return;
    }

    // Check if domain already exists globally
    const existing = await DomainModel.findOne({ domainName: normalizedDomain });
    if (existing) {
      res.status(409).json({
        error: 'DOMAIN_ALREADY_EXISTS',
        message: `Domain '${normalizedDomain}' is already claimed by an organization.`,
      });
      return;
    }

    // Stalwart domain creation and DNS provisioning happen only when a Super
    // Admin explicitly clicks "Activate Domain" — never at add-domain time.
    // See backend/src/services/domain-activation.service.ts.
    const domainCount = await DomainModel.countDocuments({ tenantId: tenant._id });
    const isPrimary = domainCount === 0;

    const newDomain = await DomainModel.create({
      tenantId: tenant._id,
      domainName: normalizedDomain,
      stalwartDomainId: null,
      status: 'active',
      dnsStatus: 'not_started',
      mailboxLimit: employeeTier,
      employeeCount: employeeTier,
      isPrimary,
    });

    // Audit log
    const actorId = req.adminUser?.id || req.user?.id;
    const actorRole = req.adminUser?.role || req.user?.role || 'TENANT_ADMIN';
    const actorEmail = req.adminUser?.email || req.user?.email || 'admin@toowix.internal';

    await AuditLogModel.create({
      actorId,
      actorRole,
      actorEmail,
      actorIp: req.ip || req.socket.remoteAddress || 'unknown',
      tenantId: tenant._id,
      action: 'DOMAIN_CREATED',
      resource: 'DOMAIN',
      resourceId: newDomain._id.toString(),
      status: 'SUCCESS',
      metadata: {
        domainName: normalizedDomain,
        employeeTier,
        mailboxLimit: employeeTier,
      },
      timestamp: new Date(),
    });

    res.status(201).json({
      success: true,
      domain: {
        id: newDomain._id.toString(),
        domainName: newDomain.domainName,
        stalwartDomainId: null,
        status: newDomain.status,
        dnsStatus: newDomain.dnsStatus,
        mailboxLimit: newDomain.mailboxLimit,
        employeeCount: newDomain.employeeCount,
        mailboxCount: 0,
        isPrimary: newDomain.isPrimary,
        createdAt: newDomain.createdAt.toISOString(),
      },
    });
  } catch (err: any) {
    console.error('[Tenant Domain Creation Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create domain.' });
  }
});

// ==========================================
// CONNECT GODADDY CREDENTIAL (/api/tenants/me/domains/:domainId/godaddy-credential)
// ==========================================
const godaddyCredentialSchema = z.object({
  apiKey: z.string().min(1, 'GoDaddy API key is required'),
  apiSecret: z.string().min(1, 'GoDaddy API secret is required'),
});

tenantMeRouter.post(
  '/me/domains/:domainId/godaddy-credential',
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.adminUser?.tenantId;
    if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
      res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant ID is missing or malformed' });
      return;
    }

    const parseResult = godaddyCredentialSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.flatten().fieldErrors });
      return;
    }

    // Scoping the lookup by tenantId (not just domainId) is the IDOR guard here —
    // a domain belonging to another tenant simply won't be found.
    try {
      const result = await connectGoDaddyCredential(
        req.params.domainId,
        tenantId,
        parseResult.data.apiKey,
        parseResult.data.apiSecret,
        {
          id: req.adminUser!.id,
          email: req.adminUser!.email,
          role: req.adminUser!.role,
        }
      );
      res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      if (err instanceof GoDaddyAuthError) {
        res.status(401).json({ error: 'GODADDY_AUTH_ERROR', message: err.message });
      } else if (err instanceof GoDaddyDomainNotManagedError) {
        res.status(422).json({ error: 'GODADDY_DOMAIN_NOT_MANAGED', message: err.message });
      } else if (err instanceof DomainActivationError) {
        res.status(err.statusCode).json({ error: err.code, message: err.message });
      } else {
        console.error('[GoDaddy Credential Connect Error]:', err);
        res.status(502).json({ error: 'GODADDY_UNAVAILABLE', message: 'Could not verify the GoDaddy credential.' });
      }
    }
  }
);

// ==========================================
// DOMAIN DNS ACTIVATION STATUS (/api/tenants/me/domains/:domainId/dns-status)
// ==========================================
tenantMeRouter.get('/me/domains/:domainId/dns-status', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser?.tenantId;
  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant ID is missing or malformed' });
    return;
  }

  try {
    const domain = await DomainModel.findOne({ _id: req.params.domainId, tenantId });
    if (!domain) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Domain not found' });
      return;
    }
    res.status(200).json({
      dnsStatus: domain.dnsStatus,
      dnsRecords: domain.dnsRecords || [],
      dnsConflicts: domain.dnsConflicts || [],
      dnsVerificationStartedAt: domain.dnsVerificationStartedAt,
      dnsVerifiedAt: domain.dnsVerifiedAt,
      activatedAt: domain.activatedAt,
    });
  } catch (err: any) {
    console.error('[Tenant Domain DNS Status Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve domain DNS status.' });
  }
});

// Helper for formatting bytes
function formatStorageBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ==========================================
// TENANT STORAGE MONITORING (/api/tenants/me/storage)
// ==========================================
tenantMeRouter.get(['/me/storage', '/storage'], async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser?.tenantId || req.user?.tenantId;
  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant ID is missing or malformed' });
    return;
  }

  const domainId = typeof req.query.domainId === 'string' && req.query.domainId.trim() ? req.query.domainId.trim() : undefined;

  try {
    const domains = await DomainModel.find({ tenantId }).lean();
    const domainMap = new Map(domains.map((d) => [d._id.toString(), d.domainName]));

    const filter: any = { tenantId };
    if (domainId && mongoose.Types.ObjectId.isValid(domainId)) {
      filter.domainId = domainId;
    }

    const mailboxes = await MailboxModel.find(filter).sort({ createdAt: 1 }).lean();

    let storageMap = new Map<string, number>();
    try {
      storageMap = await stalwartClient.listAccountsWithStorage();
    } catch (err: any) {
      console.warn('[Tenant Storage] Stalwart storage lookup failed:', err.message);
    }

    let totalStorageBytes = 0;
    let mailboxesWithData = 0;

    const mailboxItems = mailboxes.map((m) => {
      const bytes = m.stalwartAccountId ? (storageMap.get(m.stalwartAccountId) || 0) : 0;
      totalStorageBytes += bytes;
      if (bytes > 0) mailboxesWithData++;
      return {
        id: m._id.toString(),
        address: m.address,
        localPart: m.localPart,
        domainId: m.domainId.toString(),
        domainName: domainMap.get(m.domainId.toString()) || m.address.split('@')[1] || '',
        storageBytes: bytes,
        storageFormatted: formatStorageBytes(bytes),
        status: m.status,
        createdAt: m.createdAt.toISOString(),
      };
    });

    const enrichedMailboxes = mailboxItems.map((m) => ({
      ...m,
      percentage: totalStorageBytes > 0 ? Math.round((m.storageBytes / totalStorageBytes) * 1000) / 10 : 0,
    }));

    enrichedMailboxes.sort((a, b) => b.storageBytes - a.storageBytes);

    res.status(200).json({
      summary: {
        totalStorageBytes,
        totalStorageFormatted: formatStorageBytes(totalStorageBytes),
        mailboxCount: mailboxes.length,
        mailboxesWithData,
      },
      mailboxes: enrichedMailboxes,
    });
  } catch (err: any) {
    console.error('[Tenant Storage Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve storage metrics' });
  }
});

