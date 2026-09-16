import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireTenantAdmin } from '../auth/middleware';
import {
  startCheckout,
  createPaymentMethodSetupIntent,
  getDomainBillingStatus,
  listTenantInvoices,
  requestUpgrade,
  requestDowngrade,
  cancelSubscription,
  BillingError,
} from '../services/billing.service';
import { config } from '../config';

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
  res.json({ publishableKey: config.stripe.publishableKey });
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
