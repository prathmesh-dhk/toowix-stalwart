import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAnyAdmin, requireSuperAdmin } from '../auth/middleware';
import { PlanModel } from '../db/models/Plan';
import { DomainModel } from '../db/models/Domain';
import { logAudit } from '../audit/service';

export const plansRouter = Router();

function serializePlan(plan: any) {
  return {
    id: plan._id.toString(),
    name: plan.name,
    badge: plan.badge || null,
    description: plan.description || null,
    seatCount: plan.seatCount,
    displayOrder: plan.displayOrder,
    isActive: plan.isActive,
    isDefault: plan.isDefault,
    billingMode: plan.billingMode,
    monthlyPriceInPaise: plan.monthlyPriceInPaise,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

// GET /api/plans — active plans only, for tier pickers (any admin, either role)
plansRouter.get('/', requireAnyAdmin, async (_req: Request, res: Response): Promise<void> => {
  const plans = await PlanModel.find({ isActive: true }).sort({ displayOrder: 1, seatCount: 1 });
  res.json({ plans: plans.map(serializePlan) });
});

// GET /api/plans/all — every plan including inactive, for Super Admin CRUD screen
plansRouter.get('/all', requireSuperAdmin, async (_req: Request, res: Response): Promise<void> => {
  const plans = await PlanModel.find({}).sort({ displayOrder: 1, seatCount: 1 });
  res.json({ plans: plans.map(serializePlan) });
});

const createPlanSchema = z.object({
  name: z.string().trim().min(1, 'Plan name is required'),
  badge: z.string().trim().max(40).optional().nullable(),
  description: z.string().trim().max(280).optional().nullable(),
  seatCount: z.number().int().min(1, 'Seat count must be at least 1'),
  displayOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  billingMode: z.enum(['fixed', 'metered']).optional(),
  monthlyPriceInPaise: z.number().int().min(0, 'Price cannot be negative').optional(),
});

async function unsetOtherDefaults(exceptId?: string) {
  await PlanModel.updateMany(
    exceptId ? { _id: { $ne: exceptId } } : {},
    { $set: { isDefault: false } }
  );
}

plansRouter.post('/', requireSuperAdmin, async (req: Request, res: Response): Promise<void> => {
  const parseResult = createPlanSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.flatten().fieldErrors });
    return;
  }

  const data = parseResult.data;
  const plan = await PlanModel.create({
    name: data.name,
    badge: data.badge || null,
    description: data.description || null,
    seatCount: data.seatCount,
    displayOrder: data.displayOrder ?? 0,
    isActive: data.isActive ?? true,
    isDefault: data.isDefault ?? false,
    billingMode: data.billingMode ?? 'fixed',
    monthlyPriceInPaise: data.monthlyPriceInPaise ?? 0,
  });

  if (plan.isDefault) {
    await unsetOtherDefaults(plan._id.toString());
  }

  await logAudit({
    actorId: req.adminUser?.id || null,
    actorRole: req.adminUser?.role || 'SUPER_ADMIN',
    action: 'PLAN_CREATED',
    resource: 'PLAN',
    resourceId: plan._id.toString(),
    metadata: { name: plan.name, seatCount: plan.seatCount },
  });

  res.status(201).json({ plan: serializePlan(plan) });
});

const updatePlanSchema = createPlanSchema.partial();

plansRouter.patch('/:id', requireSuperAdmin, async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(400).json({ error: 'INVALID_ID', message: 'Invalid plan ID' });
    return;
  }

  const parseResult = updatePlanSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.flatten().fieldErrors });
    return;
  }

  const plan = await PlanModel.findById(req.params.id);
  if (!plan) {
    res.status(404).json({ error: 'PLAN_NOT_FOUND', message: 'Plan not found' });
    return;
  }

  const data = parseResult.data;
  if (data.name !== undefined) plan.name = data.name;
  if (data.badge !== undefined) plan.badge = data.badge || null;
  if (data.description !== undefined) plan.description = data.description || null;
  if (data.seatCount !== undefined) plan.seatCount = data.seatCount;
  if (data.displayOrder !== undefined) plan.displayOrder = data.displayOrder;
  if (data.isActive !== undefined) plan.isActive = data.isActive;
  if (data.isDefault !== undefined) plan.isDefault = data.isDefault;
  if (data.billingMode !== undefined) plan.billingMode = data.billingMode;
  if (data.monthlyPriceInPaise !== undefined) plan.monthlyPriceInPaise = data.monthlyPriceInPaise;
  // Stripe Price objects are immutable — a price/mode change means the
  // cached stripePriceId is stale; clear it so the next checkout creates
  // a fresh Price instead of billing the old amount.
  if (data.monthlyPriceInPaise !== undefined || data.billingMode !== undefined) {
    plan.stripePriceId = null;
  }

  await plan.save();

  if (plan.isDefault) {
    await unsetOtherDefaults(plan._id.toString());
  }

  await logAudit({
    actorId: req.adminUser?.id || null,
    actorRole: req.adminUser?.role || 'SUPER_ADMIN',
    action: 'PLAN_UPDATED',
    resource: 'PLAN',
    resourceId: plan._id.toString(),
    metadata: { name: plan.name, seatCount: plan.seatCount, isActive: plan.isActive, isDefault: plan.isDefault },
  });

  res.json({ plan: serializePlan(plan) });
});

plansRouter.delete('/:id', requireSuperAdmin, async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(400).json({ error: 'INVALID_ID', message: 'Invalid plan ID' });
    return;
  }

  const plan = await PlanModel.findById(req.params.id);
  if (!plan) {
    res.status(404).json({ error: 'PLAN_NOT_FOUND', message: 'Plan not found' });
    return;
  }

  const referenced = await DomainModel.exists({ planId: plan._id });
  if (referenced) {
    res.status(409).json({
      error: 'PLAN_IN_USE',
      message: 'This plan is still assigned to one or more domains. Deactivate it instead of deleting it.',
    });
    return;
  }

  await plan.deleteOne();

  await logAudit({
    actorId: req.adminUser?.id || null,
    actorRole: req.adminUser?.role || 'SUPER_ADMIN',
    action: 'PLAN_DELETED',
    resource: 'PLAN',
    resourceId: req.params.id,
    metadata: { name: plan.name },
  });

  res.json({ success: true });
});
