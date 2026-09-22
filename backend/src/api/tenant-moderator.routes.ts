import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { requireTenantAdmin } from '../auth/middleware';
import { AdminUserModel } from '../db/models/AdminUser';
import { DomainModel } from '../db/models/Domain';
import { AuditLogModel } from '../db/models/AuditLog';
import { hashPassword } from '../auth/service';
import { isRegistrationEmailBlocked, REGISTRATION_EMAIL_BLOCKED_RESPONSE } from '../services/registration-block.service';
import { MailboxService } from '../services/mailbox.service';
import { getSharedDomainListEntry } from './tenant.routes';

/**
 * Tenant Admin's own CRUD for TENANT_MODERATOR accounts within their tenant — the direct-create
 * counterpart to Super Admin creating a Tenant Admin (platform-tenant.routes.ts's /:id/admins),
 * plus scope (domainIds) management that has no Tenant Admin equivalent. Tenant-Admin-only: a
 * Moderator can never create, edit, or remove another account, including another Moderator.
 */
export const tenantModeratorRouter = Router();

tenantModeratorRouter.use(requireTenantAdmin);

function mapModerator(m: InstanceType<typeof AdminUserModel>) {
  return {
    id: m._id.toString(),
    email: m.email,
    role: m.role,
    status: m.status,
    twoFactorEnabled: m.twoFactorEnabled,
    scopedDomainIds: m.scopedDomainIds.map((id) => id.toString()),
    createdAt: m.createdAt.toISOString(),
  };
}

/** Every domain ID a scope assignment is allowed to name: this tenant's own domains, plus the
 * shared platform domain (dhkmail.com) if they've subscribed to it — the same set they'd see in
 * their own domain list. */
async function validDomainIdsForTenant(tenantId: string): Promise<Set<string>> {
  const [ownDomains, sharedEntry] = await Promise.all([
    DomainModel.find({ tenantId }).select('_id'),
    getSharedDomainListEntry(tenantId),
  ]);
  const ids = new Set(ownDomains.map((d) => d._id.toString()));
  if (sharedEntry) ids.add(sharedEntry.id);
  return ids;
}

const scopedDomainIdsSchema = z.array(z.string()).default([]);

tenantModeratorRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  const moderators = await AdminUserModel.find({ tenantId, role: 'TENANT_MODERATOR' }).sort({ createdAt: 1 });
  res.status(200).json({ moderators: moderators.map(mapModerator) });
});

const createModeratorSchema = z.object({
  email: z.string().email('Invalid email address format'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  scopedDomainIds: scopedDomainIdsSchema,
});

tenantModeratorRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;

  const parsed = createModeratorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }

  const normalizedEmail = parsed.data.email.toLowerCase().trim();

  if (await isRegistrationEmailBlocked(normalizedEmail, { ip: req.ip || 'unknown', source: 'tenant-add-moderator' })) {
    res.status(403).json(REGISTRATION_EMAIL_BLOCKED_RESPONSE);
    return;
  }

  const existing = await AdminUserModel.findOne({ email: normalizedEmail });
  if (existing) {
    res.status(409).json({ error: 'ACCOUNT_EXISTS', message: `An account with email "${normalizedEmail}" already exists` });
    return;
  }

  // A Moderator's login must be an existing mailbox this tenant owns — the frontend offers a
  // picker over MailboxService.listMailboxes rather than a free-text email field, but the backend
  // re-checks rather than trusting that, since listMailboxes is exactly what already excludes
  // every other tenant's dhkmail mailboxes (via ownerTenantId) from this tenant's own list.
  const ownMailboxes = await MailboxService.listMailboxes(tenantId);
  if (!ownMailboxes.some((m) => m.address.toLowerCase() === normalizedEmail)) {
    res.status(404).json({
      error: 'MAILBOX_NOT_FOUND',
      message: `'${normalizedEmail}' is not an existing mailbox for this organisation. Pick one of your organisation's mailboxes to make it a Moderator login.`,
    });
    return;
  }

  const validIds = await validDomainIdsForTenant(tenantId);
  const invalidId = parsed.data.scopedDomainIds.find((id) => !validIds.has(id));
  if (invalidId) {
    res.status(404).json({ error: 'DOMAIN_NOT_FOUND', message: `Domain '${invalidId}' does not belong to this organisation` });
    return;
  }

  const passwordHash = await hashPassword(parsed.data.password);

  const moderator = await AdminUserModel.create({
    email: normalizedEmail,
    passwordHash,
    role: 'TENANT_MODERATOR',
    tenantId,
    status: 'active',
    twoFactorEnabled: false,
    scopedDomainIds: parsed.data.scopedDomainIds,
  });

  await AuditLogModel.create({
    actorId: req.adminUser!.id,
    actorRole: req.adminUser!.role,
    actorEmail: req.adminUser!.email,
    actorIp: req.ip,
    tenantId,
    action: 'TENANT_MODERATOR_CREATED',
    resource: 'ADMIN_USER',
    resourceId: moderator._id.toString(),
    status: 'SUCCESS',
    metadata: { email: moderator.email, scopedDomainIds: parsed.data.scopedDomainIds },
    timestamp: new Date(),
  });

  res.status(201).json({ moderator: mapModerator(moderator) });
});

const updateModeratorSchema = z.object({
  scopedDomainIds: scopedDomainIdsSchema.optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

tenantModeratorRouter.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(400).json({ error: 'INVALID_ID', message: 'Malformed moderator ID' });
    return;
  }

  const parsed = updateModeratorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }

  const moderator = await AdminUserModel.findOne({ _id: req.params.id, tenantId, role: 'TENANT_MODERATOR' });
  if (!moderator) {
    res.status(404).json({ error: 'MODERATOR_NOT_FOUND', message: 'Moderator not found' });
    return;
  }

  if (parsed.data.scopedDomainIds !== undefined) {
    const validIds = await validDomainIdsForTenant(tenantId);
    const invalidId = parsed.data.scopedDomainIds.find((id) => !validIds.has(id));
    if (invalidId) {
      res.status(404).json({ error: 'DOMAIN_NOT_FOUND', message: `Domain '${invalidId}' does not belong to this organisation` });
      return;
    }
    moderator.scopedDomainIds = parsed.data.scopedDomainIds as any;
  }
  if (parsed.data.status !== undefined) {
    moderator.status = parsed.data.status;
  }
  await moderator.save();

  await AuditLogModel.create({
    actorId: req.adminUser!.id,
    actorRole: req.adminUser!.role,
    actorEmail: req.adminUser!.email,
    actorIp: req.ip,
    tenantId,
    action: 'TENANT_MODERATOR_UPDATED',
    resource: 'ADMIN_USER',
    resourceId: moderator._id.toString(),
    status: 'SUCCESS',
    metadata: { email: moderator.email, ...parsed.data },
    timestamp: new Date(),
  });

  res.status(200).json({ moderator: mapModerator(moderator) });
});

tenantModeratorRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(400).json({ error: 'INVALID_ID', message: 'Malformed moderator ID' });
    return;
  }

  const moderator = await AdminUserModel.findOneAndDelete({ _id: req.params.id, tenantId, role: 'TENANT_MODERATOR' });
  if (!moderator) {
    res.status(404).json({ error: 'MODERATOR_NOT_FOUND', message: 'Moderator not found' });
    return;
  }

  await AuditLogModel.create({
    actorId: req.adminUser!.id,
    actorRole: req.adminUser!.role,
    actorEmail: req.adminUser!.email,
    actorIp: req.ip,
    tenantId,
    action: 'TENANT_MODERATOR_DELETED',
    resource: 'ADMIN_USER',
    resourceId: moderator._id.toString(),
    status: 'SUCCESS',
    metadata: { email: moderator.email },
    timestamp: new Date(),
  });

  res.status(200).json({ message: 'Moderator successfully removed' });
});
