import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireTenantAdmin, requireAnyAdmin } from '../auth/middleware';
import { MailboxService } from '../services/mailbox.service';

export const tenantMailboxRouter = Router();
export const mailboxRouter = Router();

const createMailboxSchema = z.object({
  localPart: z
    .string()
    .min(1, 'Local part is required')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Local part can only contain letters, numbers, dots, hyphens, and underscores'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters long'),
});

// ==========================================
// TENANT ADMIN SCOPED ROUTES (/api/tenants/me/mailboxes)
// ==========================================

tenantMailboxRouter.use(requireTenantAdmin);

tenantMailboxRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser?.tenantId || req.user?.tenantId;
  if (!tenantId) {
    res.status(400).json({ error: 'INVALID_TENANT_ID', message: 'Tenant ID is missing' });
    return;
  }

  try {
    const mailboxes = await MailboxService.listMailboxes(tenantId);
    res.status(200).json({ mailboxes });
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

mailboxRouter.use(requireAnyAdmin);

mailboxRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const role = req.adminUser?.role || req.user?.role;
  const tenantId = role === 'TENANT_ADMIN' ? (req.adminUser?.tenantId || req.user?.tenantId || undefined) : undefined;

  try {
    const mailbox = await MailboxService.getMailboxById(req.params.id, tenantId);
    if (!mailbox) {
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
  const tenantId = role === 'TENANT_ADMIN' ? (req.adminUser?.tenantId || req.user?.tenantId || undefined) : undefined;

  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }

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

mailboxRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const role = req.adminUser?.role || req.user?.role;
  const tenantId = role === 'TENANT_ADMIN' ? (req.adminUser?.tenantId || req.user?.tenantId || undefined) : undefined;

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
