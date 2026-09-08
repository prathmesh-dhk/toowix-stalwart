import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../auth/middleware';
import { AuditLogModel } from '../db/models/AuditLog';

export const auditRouter = Router();

auditRouter.use(requireAuth);

/**
 * GET /api/audit-logs
 * Platform/Super Admin: can view all audit logs, optional filtering by tenantId, action.
 * Tenant Admin: automatically filtered to ONLY their own tenantId.
 */
auditRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const user = req.adminUser || req.user!;
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
  const offset = Math.max(0, parseInt((req.query.offset as string) || '0', 10));

  const filter: any = {};

  if (user.role === 'TENANT_ADMIN') {
    if (!user.tenantId || !mongoose.Types.ObjectId.isValid(user.tenantId)) {
      res.status(200).json({ logs: [], limit, offset });
      return;
    }
    filter.tenantId = new mongoose.Types.ObjectId(user.tenantId);
  } else if (req.query.tenantId) {
    if (mongoose.Types.ObjectId.isValid(req.query.tenantId as string)) {
      filter.tenantId = new mongoose.Types.ObjectId(req.query.tenantId as string);
    }
  }

  if (req.query.action) {
    filter.action = req.query.action as string;
  }

  try {
    const results = await AuditLogModel.find(filter)
      .sort({ timestamp: -1 })
      .skip(offset)
      .limit(limit);

    const logs = results.map((r) => ({
      id: r._id.toString(),
      actor_id: r.actorId ? r.actorId.toString() : null,
      actor_role: r.actorRole,
      actor_email: r.actorEmail || null,
      tenant_id: r.tenantId ? r.tenantId.toString() : null,
      action: r.action,
      resource: r.resource,
      resource_id: r.resourceId || null,
      metadata: r.metadata || {},
      success: r.status === 'SUCCESS',
      status: r.status,
      timestamp: r.timestamp.toISOString(),
    }));

    res.status(200).json({
      logs,
      limit,
      offset,
    });
  } catch (err: any) {
    console.error('[AuditLogs Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve audit logs' });
  }
});
