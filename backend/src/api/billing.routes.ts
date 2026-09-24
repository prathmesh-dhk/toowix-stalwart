import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireTenantAdmin } from '../auth/middleware';
import {
  startCheckout,
  createPaymentMethodSetupIntent,
  createTenantSetupIntent,
  listTenantPaymentMethods,
  saveTenantPaymentMethod,
  deleteTenantPaymentMethod,
  setDefaultPaymentMethod,
  attachDomainWithSavedPayment,
  getDomainBillingStatus,
  listTenantInvoices,
  getTenantBillingSummary,
  requestUpgrade,
  requestDowngrade,
  cancelSubscription,
  cancelTenantSubscription,
  resumeTenantSubscription,
  selectDomainPlan,
  startTenantTrialWithPayment,
  BillingError,
} from '../services/billing.service';
import { config, isBillingEnabled } from '../config';
import { couponService } from '../services/coupon.service';

export const tenantBillingRouter = Router();

tenantBillingRouter.use(requireTenantAdmin);

function actorFromReq(req: Request) {
  return {
    id: req.adminUser?.id || '',
    email: req.adminUser?.email || '',
    role: req.adminUser?.role || 'TENANT_ADMIN',
  };
}

function handleBillingError(res: Response, err: any) {
  if (err instanceof BillingError) {
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }
  console.error('[BillingRoutes]', err);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message || 'Billing operation failed' });
}

tenantBillingRouter.get('/config', async (_req: Request, res: Response): Promise<void> => {
  res.json({
    publishableKey: config.stripe.publishableKey,
    billingEnabled: isBillingEnabled(),
  });
});

tenantBillingRouter.post('/domains/:domainId/checkout', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  try {
    const result = await startCheckout(req.params.domainId, tenantId, actorFromReq(req));
    res.json(result);
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

tenantBillingRouter.get('/domains/:domainId', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  try {
    const { domain, subscription } = await getDomainBillingStatus(req.params.domainId, tenantId);
    res.json({
      domainId: domain._id.toString(),
      domainName: domain.domainName,
      subscription: subscription
        ? {
            status: subscription.status,
            planId: subscription.planId,
            currentPeriodEnd: subscription.currentPeriodEnd,
            trialEnd: subscription.trialEnd,
            gracePeriodEndsAt: subscription.gracePeriodEndsAt,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            pendingDowngradePlanId: subscription.pendingDowngradePlanId,
          }
        : null,
    });
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

tenantBillingRouter.get('/summary', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  try {
    const summary = await getTenantBillingSummary(tenantId);
    res.json(summary);
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

tenantBillingRouter.get('/invoices', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  try {
    const invoices = await listTenantInvoices(tenantId);
    res.json({
      invoices: invoices.map((inv) => ({
        id: inv.id,
        status: inv.status,
        amountPaid: inv.amount_paid,
        currency: inv.currency,
        createdAt: inv.created ? new Date(inv.created * 1000).toISOString() : null,
        hostedInvoiceUrl: inv.hosted_invoice_url || null,
        invoicePdf: inv.invoice_pdf || null,
      })),
    });
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

tenantBillingRouter.post('/domains/:domainId/setup-intent', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  try {
    const result = await createPaymentMethodSetupIntent(req.params.domainId, tenantId);
    res.json(result);
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

const planIdSchema = z.object({ planId: z.string().min(1) });

// First-time plan pick for a domain created without one — the tail end of the domain-setup
// wizard, once DNS is configured. Distinct from /upgrade and /downgrade, which change the plan
// on a domain that already has a live subscription.
tenantBillingRouter.post('/domains/:domainId/select-plan', async (req: Request, res: Response): Promise<void> => {
  const parseResult = planIdSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.flatten().fieldErrors });
    return;
  }
  const tenantId = req.adminUser!.tenantId!;
  try {
    const domain = await selectDomainPlan(req.params.domainId, tenantId, parseResult.data.planId, actorFromReq(req));
    res.json({
      success: true,
      domain: {
        id: domain._id.toString(),
        domainName: domain.domainName,
        mailboxLimit: domain.mailboxLimit,
        employeeCount: domain.employeeCount,
        planId: domain.planId ? domain.planId.toString() : null,
        planName: domain.planName || null,
      },
    });
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

tenantBillingRouter.post('/domains/:domainId/upgrade', async (req: Request, res: Response): Promise<void> => {
  const parseResult = planIdSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.flatten().fieldErrors });
    return;
  }
  const tenantId = req.adminUser!.tenantId!;
  try {
    await requestUpgrade(req.params.domainId, tenantId, parseResult.data.planId, actorFromReq(req));
    res.json({ success: true });
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

tenantBillingRouter.post('/domains/:domainId/downgrade', async (req: Request, res: Response): Promise<void> => {
  const parseResult = planIdSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.flatten().fieldErrors });
    return;
  }
  const tenantId = req.adminUser!.tenantId!;
  try {
    await requestDowngrade(req.params.domainId, tenantId, parseResult.data.planId, actorFromReq(req));
    res.json({ success: true });
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

tenantBillingRouter.post('/domains/:domainId/cancel', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  try {
    await cancelSubscription(req.params.domainId, tenantId, actorFromReq(req));
    res.json({ success: true });
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

// Master Tenant Subscription Cancellation (at period end)
tenantBillingRouter.post('/cancel', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  try {
    await cancelTenantSubscription(tenantId, actorFromReq(req));
    res.json({ success: true });
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

// Master Tenant Subscription Resume (undo scheduled cancellation)
tenantBillingRouter.post('/resume', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  try {
    await resumeTenantSubscription(tenantId, actorFromReq(req));
    res.json({ success: true });
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

// Tenant-wide Payment Methods

// Starts the 60-day trial with a payment method — called from the seamless first-mailbox
// creation flow when the admin has no card on file yet. Saves the card, sets trial dates,
// and creates the master Stripe subscription across all configured domains.
const startTrialSchema = z.object({
  paymentMethodId: z.string().optional(),
  brand: z.string().optional(),
  last4: z.string().optional(),
  expMonth: z.number().optional(),
  expYear: z.number().optional(),
});

tenantBillingRouter.post('/start-trial-with-payment', async (req: Request, res: Response): Promise<void> => {
  const parseResult = startTrialSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.flatten().fieldErrors });
    return;
  }
  const tenantId = req.adminUser!.tenantId!;
  try {
    const result = await startTenantTrialWithPayment(tenantId, parseResult.data, actorFromReq(req));
    res.json(result);
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

tenantBillingRouter.get('/payment-methods', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  try {
    const result = await listTenantPaymentMethods(tenantId);
    res.json(result);
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

tenantBillingRouter.post('/setup-intent', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  try {
    const result = await createTenantSetupIntent(tenantId);
    res.json(result);
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

const savePaymentMethodSchema = z.object({
  paymentMethodId: z.string().optional(),
  brand: z.string().optional(),
  last4: z.string().optional(),
  expMonth: z.number().optional(),
  expYear: z.number().optional(),
  isDefault: z.boolean().optional(),
});

tenantBillingRouter.post('/payment-methods', async (req: Request, res: Response): Promise<void> => {
  const parseResult = savePaymentMethodSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.flatten().fieldErrors });
    return;
  }
  const tenantId = req.adminUser!.tenantId!;
  try {
    const result = await saveTenantPaymentMethod(tenantId, parseResult.data);
    res.json(result);
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

tenantBillingRouter.delete('/payment-methods/:id', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  try {
    const result = await deleteTenantPaymentMethod(tenantId, req.params.id);
    res.json(result);
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

tenantBillingRouter.post('/payment-methods/:id/default', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  try {
    const result = await setDefaultPaymentMethod(tenantId, req.params.id);
    res.json(result);
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

tenantBillingRouter.post('/domains/:domainId/attach-payment', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.adminUser!.tenantId!;
  try {
    const result = await attachDomainWithSavedPayment(req.params.domainId, tenantId, actorFromReq(req));
    res.json(result);
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

const validateCouponSchema = z.object({
  code: z.string().trim().min(1, 'Coupon code is required'),
});

tenantBillingRouter.post('/validate-coupon', async (req: Request, res: Response): Promise<void> => {
  const parseResult = validateCouponSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.flatten().fieldErrors });
    return;
  }
  const tenantId = req.adminUser!.tenantId!;
  try {
    const result = await couponService.validateCoupon(parseResult.data.code, tenantId);
    if (!result.valid) {
      res.status(400).json({ error: 'INVALID_COUPON', message: result.message });
      return;
    }
    res.json(result);
  } catch (err: any) {
    handleBillingError(res, err);
  }
});

const redeemCouponSchema = z.object({
  code: z.string().trim().min(1, 'Coupon code is required'),
  domainId: z.string().optional().nullable(),
});

tenantBillingRouter.post('/redeem-coupon', async (req: Request, res: Response): Promise<void> => {
  const parseResult = redeemCouponSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parseResult.error.flatten().fieldErrors });
    return;
  }
  const tenantId = req.adminUser!.tenantId!;
  try {
    const result = await couponService.redeemCoupon(
      parseResult.data.code,
      tenantId,
      parseResult.data.domainId,
      req.adminUser?.id || null
    );
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: 'REDEEM_COUPON_FAILED', message: err.message });
  }
});

