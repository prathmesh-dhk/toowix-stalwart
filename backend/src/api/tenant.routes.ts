import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { requireTenantAdmin } from '../auth/middleware';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { AdminUserModel } from '../db/models/AdminUser';

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

    const domain = await DomainModel.findOne({ tenantId: tenant._id });
    const adminCount = await AdminUserModel.countDocuments({ tenantId: tenant._id });

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
        domain: domain
          ? {
              id: domain._id.toString(),
              domainName: domain.domainName,
              stalwartDomainId: domain.stalwartDomainId || null,
              status: domain.status,
            }
          : null,
      },
    });
  } catch (err: any) {
    console.error('[TenantMe Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve tenant context' });
  }
});
