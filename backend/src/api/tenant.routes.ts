import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireTenantAdmin } from '../auth/middleware';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { AdminUserModel } from '../db/models/AdminUser';
import { MailboxModel } from '../db/models/Mailbox';
import { AuditLogModel } from '../db/models/AuditLog';
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

    // Provision domain in Stalwart
    let stalwartDomainId: string | null = null;
    try {
      const created = await stalwartClient.createDomain(normalizedDomain, `Tenant: ${tenant.name}`);
      stalwartDomainId = created.id;
    } catch (err: any) {
      if (err.name === 'StalwartDomainExistsError' || err.code === 'DOMAIN_EXISTS') {
        try {
          const list = await stalwartClient.listDomains();
          const match = list.find((d) => d.name.toLowerCase() === normalizedDomain);
          stalwartDomainId = match ? match.id : null;
        } catch {
          stalwartDomainId = null;
        }
      } else {
        console.warn('[Stalwart Provision Warning - Proceeding with local domain]:', err.message);
      }
    }

    const domainCount = await DomainModel.countDocuments({ tenantId: tenant._id });
    const isPrimary = domainCount === 0;

    const newDomain = await DomainModel.create({
      tenantId: tenant._id,
      domainName: normalizedDomain,
      stalwartDomainId,
      status: 'active',
      mailboxLimit: employeeTier,
      employeeCount: employeeTier,
      isPrimary,
    });

    // Generate DNS Zone configuration
    const dnsRecords = [
      {
        type: 'MX',
        name: '@',
        target: `mail.${normalizedDomain}`,
        priority: '10',
        desc: 'Primary Mail Routing Exchange',
      },
      {
        type: 'TXT',
        name: '@',
        target: 'v=spf1 mx include:relay.toowix.net ~all',
        priority: 'TTL 3600',
        desc: 'Sender Policy Framework (SPF)',
      },
      {
        type: 'TXT',
        name: `mail._domainkey.${normalizedDomain}`,
        target: 'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDH3m5qL7...',
        priority: 'TTL 3600',
        desc: 'DomainKeys Identified Mail (DKIM)',
      },
      {
        type: 'TXT',
        name: '_dmarc',
        target: `v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@${normalizedDomain}`,
        priority: 'TTL 3600',
        desc: 'Domain-based Message Authentication Reporting (DMARC)',
      },
    ];

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
        stalwartDomainId: newDomain.stalwartDomainId || null,
        status: newDomain.status,
        mailboxLimit: newDomain.mailboxLimit,
        employeeCount: newDomain.employeeCount,
        mailboxCount: 0,
        isPrimary: newDomain.isPrimary,
        createdAt: newDomain.createdAt.toISOString(),
      },
      dnsRecords,
    });
  } catch (err: any) {
    console.error('[Tenant Domain Creation Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create domain.' });
  }
});
