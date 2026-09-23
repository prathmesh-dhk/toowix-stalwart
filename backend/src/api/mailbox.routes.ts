import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireTenantAdminOrModerator, requireAnyAdminOrModerator, isDomainInScope } from '../auth/middleware';
import { MailboxService } from '../services/mailbox.service';
import { startMailboxMigration, startMigrationAndDelete, getMigrationJobStatus } from '../services/mailbox-migration.service';
import { stalwartClient } from '../stalwart/client';

export const tenantMailboxRouter = Router();
export const mailboxRouter = Router();

/**
 * For a Moderator only: confirms the target mailbox exists and its domain is in scope before a
 * write action runs, sending 404 (not 403 — avoids revealing whether the mailbox exists at all
 * to someone outside its domain, same IDOR-prevention convention used elsewhere) and returning
 * false if not. A no-op (true) for every other role — MailboxService's own tenantId-scoped lookup
 * already handles their access boundary.
 */
async function assertMailboxInModeratorScope(req: Request, res: Response, mailboxId: string, tenantId?: string): Promise<boolean> {
  if (!req.adminUser || req.adminUser.role !== 'TENANT_MODERATOR') return true;
  const mailbox = await MailboxService.getMailboxById(mailboxId, tenantId);
  if (!mailbox || !isDomainInScope(req.adminUser, mailbox.domainId)) {
    res.status(404).json({ error: 'MAILBOX_NOT_FOUND', message: 'Mailbox not found' });
    return false;
  }
  return true;
}

const createMailboxSchema = z.object({
  displayName: z.string().trim().min(1, 'Name cannot be empty').max(100, 'Name cannot exceed 100 characters').optional(),
  localPart: z
    .string()
    .min(1, 'Local part is required')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Local part can only contain letters, numbers, dots, hyphens, and underscores'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  domainId: z.string().optional(),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters long'),
});

const addAliasSchema = z.object({
  localPart: z
    .string()
    .min(1, 'Local part is required')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Local part can only contain letters, numbers, dots, hyphens, and underscores'),
  description: z.string().max(200, 'Description cannot exceed 200 characters').optional().nullable(),
  // Accepted for old clients but deliberately ignored: aliases are always
  // created on the mailbox's own domain.
  domainId: z.string().optional(),
});

// ==========================================
// TENANT ADMIN SCOPED ROUTES (/api/tenants/me/mailboxes)
// ==========================================

tenantMailboxRouter.use(requireTenantAdminOrModerator);

tenantMailboxRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser?.tenantId || req.user?.tenantId;
  if (!tenantId) {
    res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant ID is missing' });
    return;
  }

  const domainId = typeof req.query.domainId === 'string' && req.query.domainId.trim() ? req.query.domainId.trim() : undefined;
  if (domainId && req.adminUser && !isDomainInScope(req.adminUser, domainId)) {
    res.status(404).json({ error: 'DOMAIN_NOT_FOUND', message: 'Domain not found' });
    return;
  }

  try {
    let mailboxes = await MailboxService.listMailboxes(tenantId, domainId);
    // No specific domain requested — a Moderator sees only mailboxes on their scoped domains,
    // never the tenant's full list (domains outside scope must be completely invisible).
    if (!domainId && req.adminUser?.role === 'TENANT_MODERATOR') {
      mailboxes = mailboxes.filter((m) => isDomainInScope(req.adminUser!, m.domainId));
    }
    res.status(200).json({ mailboxes });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

// GET /api/tenants/me/mailboxes/storage
tenantMailboxRouter.get('/storage', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser?.tenantId || req.user?.tenantId;
  if (!tenantId) {
    res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant ID is missing' });
    return;
  }

  const domainId = typeof req.query.domainId === 'string' && req.query.domainId.trim() ? req.query.domainId.trim() : undefined;
  if (domainId && req.adminUser && !isDomainInScope(req.adminUser, domainId)) {
    res.status(404).json({ error: 'DOMAIN_NOT_FOUND', message: 'Domain not found' });
    return;
  }

  try {
    let mailboxes = await MailboxService.listMailboxes(tenantId, domainId);
    if (!domainId && req.adminUser?.role === 'TENANT_MODERATOR') {
      mailboxes = mailboxes.filter((m) => isDomainInScope(req.adminUser!, m.domainId));
    }
    let storageMap = new Map<string, number>();
    try {
      storageMap = await stalwartClient.listAccountsWithStorage();
    } catch {
      // Graceful fallback
    }

    let totalStorageBytes = 0;
    let mailboxesWithData = 0;

    const mailboxItems = mailboxes.map((m) => {
      const bytes = m.stalwartAccountId ? (storageMap.get(m.stalwartAccountId) || 0) : 0;
      totalStorageBytes += bytes;
      if (bytes > 0) mailboxesWithData++;
      return {
        id: m.id,
        address: m.address,
        localPart: m.localPart,
        domainId: m.domainId,
        storageBytes: bytes,
        status: m.status,
        createdAt: m.createdAt,
      };
    });

    res.status(200).json({
      summary: {
        totalStorageBytes,
        mailboxCount: mailboxes.length,
        mailboxesWithData,
      },
      mailboxes: mailboxItems,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

tenantMailboxRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser?.tenantId || req.user?.tenantId;
  if (!tenantId) {
    res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant ID is missing' });
    return;
  }

  const parsed = createMailboxSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }

  if (req.adminUser?.role === 'TENANT_MODERATOR') {
    // A Moderator must name the domain explicitly — createMailbox defaults a missing domainId to
    // the tenant's primary domain, which would silently bypass scope if left to fall through.
    if (!parsed.data.domainId || !isDomainInScope(req.adminUser, parsed.data.domainId)) {
      res.status(404).json({ error: 'DOMAIN_NOT_FOUND', message: 'Domain not found' });
      return;
    }
  }

  try {
    const mailbox = await MailboxService.createMailbox(
      tenantId,
      parsed.data,
      req.adminUser?.id || req.user?.id,
      req.adminUser?.role || req.user?.role
    );
    res.status(201).json(mailbox);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

// ==========================================
// RESOURCE-LEVEL ROUTES (/api/mailboxes)
// ==========================================

mailboxRouter.use(requireAnyAdminOrModerator);

mailboxRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const role = req.adminUser?.role || req.user?.role;
  const tenantId = role === 'TENANT_ADMIN' || role === 'TENANT_MODERATOR' ? (req.adminUser?.tenantId || req.user?.tenantId || undefined) : undefined;

  try {
    const mailbox = await MailboxService.getMailboxById(req.params.id, tenantId);
    if (!mailbox || (req.adminUser && !isDomainInScope(req.adminUser, mailbox.domainId))) {
      res.status(404).json({ error: 'MAILBOX_NOT_FOUND', message: 'Mailbox not found' });
      return;
    }
    res.status(200).json(mailbox);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

mailboxRouter.post('/:id/reset-password', async (req: Request, res: Response): Promise<void> => {
  const role = req.adminUser?.role || req.user?.role;
  const tenantId = role === 'TENANT_ADMIN' || role === 'TENANT_MODERATOR' ? (req.adminUser?.tenantId || req.user?.tenantId || undefined) : undefined;

  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }

  if (!(await assertMailboxInModeratorScope(req, res, req.params.id, tenantId))) return;

  try {
    await MailboxService.resetPassword(
      req.params.id,
      parsed.data.newPassword,
      tenantId,
      req.adminUser?.id || req.user?.id,
      req.adminUser?.role || req.user?.role
    );
    res.status(200).json({ message: 'Mailbox password successfully reset' });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

mailboxRouter.post('/:id/suspend', async (req: Request, res: Response): Promise<void> => {
  const role = req.adminUser?.role || req.user?.role;
  const tenantId = role === 'TENANT_ADMIN' || role === 'TENANT_MODERATOR' ? (req.adminUser?.tenantId || req.user?.tenantId || undefined) : undefined;

  if (!(await assertMailboxInModeratorScope(req, res, req.params.id, tenantId))) return;

  try {
    const mailbox = await MailboxService.suspendMailbox(
      req.params.id,
      tenantId,
      req.adminUser?.id || req.user?.id,
      req.adminUser?.role || req.user?.role
    );
    res.status(200).json({ message: 'Mailbox successfully suspended', mailbox });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

mailboxRouter.post('/:id/reactivate', async (req: Request, res: Response): Promise<void> => {
  const role = req.adminUser?.role || req.user?.role;
  const tenantId = role === 'TENANT_ADMIN' || role === 'TENANT_MODERATOR' ? (req.adminUser?.tenantId || req.user?.tenantId || undefined) : undefined;

  if (!(await assertMailboxInModeratorScope(req, res, req.params.id, tenantId))) return;

  try {
    const mailbox = await MailboxService.reactivateMailbox(
      req.params.id,
      tenantId,
      req.adminUser?.id || req.user?.id,
      req.adminUser?.role || req.user?.role
    );
    res.status(200).json({ message: 'Mailbox successfully reactivated', mailbox });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

mailboxRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const role = req.adminUser?.role || req.user?.role;
  const tenantId = role === 'TENANT_ADMIN' || role === 'TENANT_MODERATOR' ? (req.adminUser?.tenantId || req.user?.tenantId || undefined) : undefined;

  if (!(await assertMailboxInModeratorScope(req, res, req.params.id, tenantId))) return;

  try {
    await MailboxService.deleteMailbox(
      req.params.id,
      tenantId,
      req.adminUser?.id || req.user?.id,
      req.adminUser?.role || req.user?.role
    );
    res.status(200).json({ message: 'Mailbox successfully deleted' });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

const migrateAndDeleteSchema = z.object({
  destinationMailboxId: z.string().min(1, 'Destination mailbox is required'),
});

// Kicks off "copy this mailbox's mail into another one" as a background job WITHOUT deleting the source mailbox.
// The source mailbox is strictly preserved until the user inspects and confirms deletion separately.
mailboxRouter.post('/:id/migrate', async (req: Request, res: Response): Promise<void> => {
  const role = req.adminUser?.role;
  const tenantId = req.adminUser?.tenantId;
  if (!tenantId || (role !== 'TENANT_ADMIN' && role !== 'TENANT_MODERATOR')) {
    res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant ID is missing or malformed' });
    return;
  }

  const parsed = migrateAndDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }

  if (!(await assertMailboxInModeratorScope(req, res, req.params.id, tenantId))) return;
  if (!(await assertMailboxInModeratorScope(req, res, parsed.data.destinationMailboxId, tenantId))) return;

  try {
    const result = await startMailboxMigration(
      req.params.id,
      parsed.data.destinationMailboxId,
      tenantId,
      false, // deleteSourceAfter: false
      req.adminUser?.id,
      role
    );
    res.status(202).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

// Legacy endpoint: Kicks off "copy this mailbox's mail into another one, then delete it" as a background job
mailboxRouter.post('/:id/migrate-and-delete', async (req: Request, res: Response): Promise<void> => {
  const role = req.adminUser?.role;
  const tenantId = req.adminUser?.tenantId;
  if (!tenantId || (role !== 'TENANT_ADMIN' && role !== 'TENANT_MODERATOR')) {
    res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant ID is missing or malformed' });
    return;
  }

  const parsed = migrateAndDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }

  if (!(await assertMailboxInModeratorScope(req, res, req.params.id, tenantId))) return;
  if (!(await assertMailboxInModeratorScope(req, res, parsed.data.destinationMailboxId, tenantId))) return;

  try {
    const result = await startMigrationAndDelete(
      req.params.id,
      parsed.data.destinationMailboxId,
      tenantId,
      req.adminUser?.id,
      role
    );
    res.status(202).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

mailboxRouter.get('/migration-jobs/:jobId', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser?.tenantId;
  if (!tenantId) {
    res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant ID is missing or malformed' });
    return;
  }

  try {
    const job = await getMigrationJobStatus(req.params.jobId, tenantId);
    res.status(200).json(job);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

// GET /api/mailboxes/:id/aliases
mailboxRouter.get('/:id/aliases', async (req: Request, res: Response): Promise<void> => {
  const role = req.adminUser?.role || req.user?.role;
  const tenantId = role === 'TENANT_ADMIN' || role === 'TENANT_MODERATOR' ? (req.adminUser?.tenantId || req.user?.tenantId || undefined) : undefined;

  if (!(await assertMailboxInModeratorScope(req, res, req.params.id, tenantId))) return;

  try {
    const aliases = await MailboxService.listAliases(req.params.id, tenantId);
    res.status(200).json({ aliases });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

// POST /api/mailboxes/:id/aliases
mailboxRouter.post('/:id/aliases', async (req: Request, res: Response): Promise<void> => {
  const role = req.adminUser?.role || req.user?.role;
  const tenantId = role === 'TENANT_ADMIN' || role === 'TENANT_MODERATOR' ? (req.adminUser?.tenantId || req.user?.tenantId || undefined) : undefined;

  if (!tenantId) {
    res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant context required' });
    return;
  }

  const parsed = addAliasSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }

  if (!(await assertMailboxInModeratorScope(req, res, req.params.id, tenantId))) return;

  try {
    const alias = await MailboxService.addAlias(
      req.params.id,
      tenantId,
      {
        localPart: parsed.data.localPart,
        description: parsed.data.description || undefined,
      },
      req.adminUser?.id || req.user?.id,
      req.adminUser?.role || req.user?.role
    );
    res.status(201).json({ alias });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

// DELETE /api/mailboxes/:id/aliases/:aliasId
mailboxRouter.delete('/:id/aliases/:aliasId', async (req: Request, res: Response): Promise<void> => {
  const role = req.adminUser?.role || req.user?.role;
  const tenantId = role === 'TENANT_ADMIN' || role === 'TENANT_MODERATOR' ? (req.adminUser?.tenantId || req.user?.tenantId || undefined) : undefined;

  if (!tenantId) {
    res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant context required' });
    return;
  }

  if (!(await assertMailboxInModeratorScope(req, res, req.params.id, tenantId))) return;

  try {
    await MailboxService.deleteAlias(
      req.params.id,
      tenantId,
      req.params.aliasId,
      req.adminUser?.id || req.user?.id,
      req.adminUser?.role || req.user?.role
    );
    res.status(200).json({ message: 'Alias successfully deleted' });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

