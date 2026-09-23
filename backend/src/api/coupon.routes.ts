import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireSuperAdmin } from '../auth/middleware';
import { couponService } from '../services/coupon.service';

export const couponRouter = Router();

couponRouter.use(requireSuperAdmin);

const createCouponSchema = z.object({
  code: z.string().trim().max(32).optional().nullable(),
  extraTrialDays: z.number().int().min(1).max(365, 'Extra trial days must be between 1 and 365'),
  expiresAt: z.string().datetime().optional().nullable().or(z.literal('')),
  description: z.string().trim().max(280).optional().nullable(),
  maxUses: z.number().int().min(1).max(10000).default(1),
});

const batchCreateCouponSchema = z.object({
  count: z.number().int().min(1).max(100),
  prefix: z.string().trim().max(12).optional(),
  extraTrialDays: z.number().int().min(1).max(365, 'Extra trial days must be between 1 and 365'),
  expiresAt: z.string().datetime().optional().nullable().or(z.literal('')),
  description: z.string().trim().max(280).optional().nullable(),
  maxUses: z.number().int().min(1).max(10000).default(1),
});

// GET /api/admin/coupons — list coupons with search, status filter, and pagination
couponRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const status = (req.query.status as string) || 'all';
    const search = (req.query.search as string) || '';
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const skip = parseInt((req.query.skip as string) || '0', 10);

    const result = await couponService.listCoupons({ status, search, limit, skip });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'FAILED_TO_LIST_COUPONS', message: err.message });
  }
});

// POST /api/admin/coupons — create single coupon
couponRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parseResult = createCouponSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      details: parseResult.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const data = parseResult.data;
    const coupon = await couponService.createCoupon(
      {
        code: data.code || undefined,
        extraTrialDays: data.extraTrialDays,
        expiresAt: data.expiresAt || null,
        description: data.description || null,
        maxUses: data.maxUses,
      },
      req.adminUser?.id || null,
      req.adminUser?.role || 'SUPER_ADMIN'
    );
    res.status(201).json({ coupon });
  } catch (err: any) {
    res.status(400).json({ error: 'CREATE_COUPON_FAILED', message: err.message });
  }
});

// POST /api/admin/coupons/batch — batch generate one-time coupons
couponRouter.post('/batch', async (req: Request, res: Response): Promise<void> => {
  const parseResult = batchCreateCouponSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      details: parseResult.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const data = parseResult.data;
    const coupons = await couponService.createBatchCoupons(
      {
        count: data.count,
        prefix: data.prefix || 'TWX',
        extraTrialDays: data.extraTrialDays,
        expiresAt: data.expiresAt || null,
        description: data.description || null,
        maxUses: data.maxUses,
      },
      req.adminUser?.id || null,
      req.adminUser?.role || 'SUPER_ADMIN'
    );
    res.status(201).json({ coupons, count: coupons.length });
  } catch (err: any) {
    res.status(400).json({ error: 'BATCH_CREATE_FAILED', message: err.message });
  }
});

// PATCH /api/admin/coupons/:id/revoke — revoke an active coupon
couponRouter.patch('/:id/revoke', async (req: Request, res: Response): Promise<void> => {
  try {
    await couponService.revokeCoupon(req.params.id, req.adminUser?.id || null);
    res.json({ success: true, message: 'Coupon revoked successfully.' });
  } catch (err: any) {
    res.status(400).json({ error: 'REVOKE_COUPON_FAILED', message: err.message });
  }
});

// DELETE /api/admin/coupons/:id — delete an unused coupon
couponRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await couponService.deleteCoupon(req.params.id, req.adminUser?.id || null);
    res.json({ success: true, message: 'Coupon deleted successfully.' });
  } catch (err: any) {
    res.status(400).json({ error: 'DELETE_COUPON_FAILED', message: err.message });
  }
});
