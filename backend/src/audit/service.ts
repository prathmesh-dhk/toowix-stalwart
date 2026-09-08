import mongoose from 'mongoose';
import { AuditLogModel } from '../db/models/AuditLog';

export interface AuditLogEntry {
  actorId?: string | null;
  actorRole: string;
  actorEmail?: string | null;
  actorIp?: string | null;
  tenantId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, any>;
  success?: boolean;
}

export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    await AuditLogModel.create({
      actorId: entry.actorId ? (mongoose.Types.ObjectId.isValid(entry.actorId) ? new mongoose.Types.ObjectId(entry.actorId) : entry.actorId) : null,
      actorRole: entry.actorRole,
      actorEmail: entry.actorEmail || null,
      actorIp: entry.actorIp || null,
      tenantId: entry.tenantId && mongoose.Types.ObjectId.isValid(entry.tenantId) ? new mongoose.Types.ObjectId(entry.tenantId) : null,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId || null,
      metadata: entry.metadata || {},
      status: entry.success === false ? 'FAILED' : 'SUCCESS',
      timestamp: new Date(),
    });
  } catch (err) {
    console.error('[AuditLog] Failed to record audit log:', err);
  }
}
