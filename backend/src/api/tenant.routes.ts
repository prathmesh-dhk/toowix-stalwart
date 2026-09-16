import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireTenantAdmin } from '../auth/middleware';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { PlanModel } from '../db/models/Plan';
import { AdminUserModel } from '../db/models/AdminUser';
import { MailboxModel } from '../db/models/Mailbox';
import { AuditLogModel } from '../db/models/AuditLog';
import { connectDnsProviderCredential, DomainActivationError } from '../services/domain-activation.service';
import { GoDaddyAuthError, GoDaddyDomainNotManagedError } from '../godaddy/errors';
import { HostingerAuthError, HostingerDomainNotManagedError } from '../hostinger/errors';
import { CloudflareAuthError, CloudflareDomainNotManagedError } from '../cloudflare/errors';
import { stalwartClient } from '../stalwart/client';
import { StalwartDomainExistsError } from '../stalwart/errors';
import { buildRequiredDnsRecords, buildZoneFileText } from '../services/dns-records.service';
import { StalwartDkimKey } from '../stalwart/types';
import { IGeneratedDnsRecord } from '../db/models/Domain';
import { securityIpService, isValidIpOrCidr } from '../services/security-ip.service';

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
        planId: d.planId ? d.planId.toString() : null,
        planName: d.planName || null,
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
  planId: z.string().min(1, 'A plan must be selected'),
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

  const { domainName, planId } = parseResult.data;
  const normalizedDomain = domainName.toLowerCase().trim();

  if (!mongoose.Types.ObjectId.isValid(planId)) {
    res.status(400).json({ error: 'INVALID_PLAN_ID', message: 'Invalid plan selected' });
    return;
  }

  try {
    const tenant = await TenantModel.findById(tenantId);
    if (!tenant) {
      res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant record not found' });
      return;
    }

    const plan = await PlanModel.findOne({ _id: planId, isActive: true });
    if (!plan) {
      res.status(404).json({ error: 'PLAN_NOT_FOUND', message: 'Selected plan is unavailable. Please choose another.' });
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

    // 1. Provision domain in Stalwart with automatic DKIM, keeping it disabled until Super Admin activation
    let stalwartDomainId: string | null = null;
    let dkimKeys: StalwartDkimKey[] = [];
    try {
      const created = await stalwartClient.createDomain(normalizedDomain, `Tenant: ${tenant.name}`);
      stalwartDomainId = created.id;
    } catch (err: any) {
      if (err instanceof StalwartDomainExistsError) {
        const list = await stalwartClient.listDomains();
        const match = list.find((d) => d.name.toLowerCase() === normalizedDomain);
        stalwartDomainId = match?.id || null;
      } else {
        console.warn(`[Tenant Domain Creation] Stalwart createDomain non-fatal failure: ${err.message}`);
      }
    }

    if (stalwartDomainId) {
      try {
        // Keep domain disabled on Stalwart so mail routing is suspended until Super Admin activates
        await stalwartClient.updateDomainStatus(stalwartDomainId, false);

        // Fetch generated DKIM keys (quick retry if Stalwart key generation is in progress)
        dkimKeys = await stalwartClient.getActiveDkimKeys(stalwartDomainId);
        if (dkimKeys.length === 0) {
          await new Promise((r) => setTimeout(r, 600));
          dkimKeys = await stalwartClient.getActiveDkimKeys(stalwartDomainId);
        }
      } catch (err: any) {
        console.warn(`[Tenant Domain Creation] Stalwart DKIM retrieval warning: ${err.message}`);
      }
    }

    // Build canonical DNS records and zone file immediately so tenant can copy and configure their DNS provider
    const dnsRecords = buildRequiredDnsRecords(normalizedDomain, dkimKeys);
    const dnsZoneFile = buildZoneFileText(normalizedDomain, dnsRecords);
    const rsaKey = dkimKeys.find((k) => k.algorithm === 'Dkim1RsaSha256') || dkimKeys[0];

    const domainCount = await DomainModel.countDocuments({ tenantId: tenant._id });
    const isPrimary = domainCount === 0;

    const newDomain = await DomainModel.create({
      tenantId: tenant._id,
      domainName: normalizedDomain,
      stalwartDomainId,
      status: 'active',
      dnsStatus: 'not_started',
      mailboxLimit: plan.seatCount,
      employeeCount: plan.seatCount,
      planId: plan._id,
      planName: plan.name,
      isPrimary,
      dnsRecords,
      dnsZoneFile,
      dkimSelector: rsaKey?.selector || null,
      dkimPublicKey: rsaKey?.publicKey || null,
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
        planId: plan._id.toString(),
        planName: plan.name,
        mailboxLimit: plan.seatCount,
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
        dnsStatus: newDomain.dnsStatus,
        mailboxLimit: newDomain.mailboxLimit,
        employeeCount: newDomain.employeeCount,
        planId: newDomain.planId ? newDomain.planId.toString() : null,
        planName: newDomain.planName || null,
        mailboxCount: 0,
        isPrimary: newDomain.isPrimary,
        dnsRecords: newDomain.dnsRecords || [],
        dnsZoneFile: newDomain.dnsZoneFile || null,
        createdAt: newDomain.createdAt.toISOString(),
      },
    });
  } catch (err: any) {
    console.error('[Tenant Domain Creation Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create domain.' });
  }
});

// ==========================================
// CONNECT DNS PROVIDER CREDENTIAL (/api/tenants/me/domains/:domainId/dns-provider-credential)
// ==========================================
const dnsProviderCredentialSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('godaddy'),
    apiKey: z.string().min(1, 'GoDaddy API key is required'),
    apiSecret: z.string().min(1, 'GoDaddy API secret is required'),
  }),
  z.object({
    provider: z.literal('hostinger'),
    token: z.string().min(1, 'Hostinger API token is required'),
  }),
  z.object({
    provider: z.literal('cloudflare'),
    token: z.string().min(1, 'Cloudflare API token is required'),
  }),
]);

tenantMeRouter.post(
  '/me/domains/:domainId/dns-provider-credential',
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.adminUser?.tenantId;
    if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
      res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant ID is missing or malformed' });
      return;
    }

    const parseResult = dnsProviderCredentialSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.flatten().fieldErrors });
      return;
    }

    const { provider, ...credential } = parseResult.data;

    // Scoping the lookup by tenantId (not just domainId) is the IDOR guard here —
    // a domain belonging to another tenant simply won't be found.
    try {
      const result = await connectDnsProviderCredential(
        req.params.domainId,
        tenantId,
        provider,
        credential as any,
        {
          id: req.adminUser!.id,
          email: req.adminUser!.email,
          role: req.adminUser!.role,
        }
      );
      res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      if (err instanceof GoDaddyAuthError || err instanceof HostingerAuthError || err instanceof CloudflareAuthError) {
        res.status(401).json({ error: 'DNS_PROVIDER_AUTH_ERROR', message: err.message });
      } else if (
        err instanceof GoDaddyDomainNotManagedError ||
        err instanceof HostingerDomainNotManagedError ||
        err instanceof CloudflareDomainNotManagedError
      ) {
        res.status(422).json({ error: 'DNS_PROVIDER_DOMAIN_NOT_MANAGED', message: err.message });
      } else if (err instanceof DomainActivationError) {
        res.status(err.statusCode).json({ error: err.code, message: err.message });
      } else {
        console.error('[DNS Provider Credential Connect Error]:', err);
        res.status(502).json({ error: 'DNS_PROVIDER_UNAVAILABLE', message: 'Could not verify the DNS provider credential.' });
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
      dnsZoneFile: domain.dnsZoneFile || null,
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

// =========================================================================
// SECURITY FIREWALL / IP MANAGEMENT (Blocked IPs, Allowed IPs, Unblock)
// =========================================================================

/**
 * Diagnostic lookup: Checks if an IP is currently blocked or whitelisted.
 * GET /api/tenants/me/security/check-ip?ip=...
 */
tenantMeRouter.get('/me/security/check-ip', async (req: Request, res: Response): Promise<void> => {
  const ip = typeof req.query.ip === 'string' ? req.query.ip.trim() : '';

  if (!ip) {
    res.status(400).json({ error: 'MISSING_IP', message: 'Target IP address is required' });
    return;
  }

  if (!isValidIpOrCidr(ip)) {
    res.status(400).json({ error: 'INVALID_IP_FORMAT', message: 'Please enter a valid IP address or CIDR range.' });
    return;
  }

  try {
    const result = await securityIpService.checkIpStatus(ip);
    res.status(200).json(result);
  } catch (err: any) {
    console.error('[Security IP Check Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to verify IP address status' });
  }
});

/**
 * Lists all currently blocked IP addresses.
 * GET /api/tenants/me/security/blocked-ips
 */
tenantMeRouter.get('/me/security/blocked-ips', async (_req: Request, res: Response): Promise<void> => {
  try {
    const list = await securityIpService.listBlockedIps();
    res.status(200).json({ list });
  } catch (err: any) {
    console.error('[List Blocked IPs Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch blocked IP list' });
  }
});

/**
 * Automated Unblock: Removes a blocked IP and reloads Stalwart firewall rules.
 * POST /api/tenants/me/security/blocked-ips/unblock
 */
tenantMeRouter.post('/me/security/blocked-ips/unblock', async (req: Request, res: Response): Promise<void> => {
  const { id, address } = req.body || {};

  if (!id && !address) {
    res.status(400).json({ error: 'MISSING_IDENTIFIER', message: 'Provide either id or address to unblock.' });
    return;
  }

  if (address && !isValidIpOrCidr(address)) {
    res.status(400).json({ error: 'INVALID_IP_FORMAT', message: 'Please provide a valid IP address.' });
    return;
  }

  try {
    const actor = {
      id: req.adminUser?.id || 'unknown',
      role: req.adminUser?.role || 'TENANT_ADMIN',
      ip: req.ip,
    };

    const result = await securityIpService.unblockIp({ id, address }, actor);
    res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Unblock IP Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message || 'Failed to unblock IP' });
  }
});

/**
 * Manually blocks an IP address and reloads Stalwart firewall rules.
 * POST /api/tenants/me/security/blocked-ips
 */
tenantMeRouter.post('/me/security/blocked-ips', async (req: Request, res: Response): Promise<void> => {
  const { address, reason } = req.body || {};

  if (!address || !isValidIpOrCidr(address)) {
    res.status(400).json({ error: 'INVALID_IP_FORMAT', message: 'Valid IP address is required.' });
    return;
  }

  try {
    const actor = {
      id: req.adminUser?.id || 'unknown',
      role: req.adminUser?.role || 'TENANT_ADMIN',
      ip: req.ip,
    };

    const item = await securityIpService.blockIp(address, reason || 'manual', actor);
    res.status(201).json({ success: true, message: 'IP address blocked successfully', item });
  } catch (err: any) {
    console.error('[Block IP Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message || 'Failed to block IP' });
  }
});

/**
 * Lists all whitelisted / allowed IP addresses.
 * GET /api/tenants/me/security/allowed-ips
 */
tenantMeRouter.get('/me/security/allowed-ips', async (_req: Request, res: Response): Promise<void> => {
  try {
    const list = await securityIpService.listAllowedIps();
    res.status(200).json({ list });
  } catch (err: any) {
    console.error('[List Allowed IPs Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch allowed IP list' });
  }
});

/**
 * Whitelists an IP address or CIDR range.
 * POST /api/tenants/me/security/allowed-ips
 */
tenantMeRouter.post('/me/security/allowed-ips', async (req: Request, res: Response): Promise<void> => {
  const { address, reason } = req.body || {};

  if (!address || !isValidIpOrCidr(address)) {
    res.status(400).json({ error: 'INVALID_IP_FORMAT', message: 'Valid IP address or CIDR range is required.' });
    return;
  }

  try {
    const actor = {
      id: req.adminUser?.id || 'unknown',
      role: req.adminUser?.role || 'TENANT_ADMIN',
      ip: req.ip,
    };

    const item = await securityIpService.addAllowedIp(
      address,
      reason || 'Whitelisted by Administrator',
      actor
    );
    res.status(201).json({ success: true, message: 'IP address whitelisted successfully', item });
  } catch (err: any) {
    console.error('[Add Allowed IP Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message || 'Failed to whitelist IP' });
  }
});

/**
 * Removes an IP from the whitelist.
 * DELETE /api/tenants/me/security/allowed-ips/:id
 */
tenantMeRouter.delete('/me/security/allowed-ips/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!id) {
    res.status(400).json({ error: 'MISSING_ID', message: 'Allowed IP ID is required.' });
    return;
  }

  try {
    const actor = {
      id: req.adminUser?.id || 'unknown',
      role: req.adminUser?.role || 'TENANT_ADMIN',
      ip: req.ip,
    };

    await securityIpService.removeAllowedIp(id, actor);
    res.status(200).json({ success: true, message: 'IP removed from whitelist successfully' });
  } catch (err: any) {
    console.error('[Remove Allowed IP Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message || 'Failed to remove allowed IP' });
  }
});

