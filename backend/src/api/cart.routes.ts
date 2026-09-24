import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireTenantAdmin } from '../auth/middleware';
import { getCartSummary } from '../services/cart.service';
import {
  startTenantTrialWithPayment,
  startCartCheckout,
  completeCartCheckout,
  startCardUpdate,
  completeCardUpdate,
  BillingError,
} from '../services/billing.service';

export const cartRouter = Router();

cartRouter.use(requireTenantAdmin);

function handleCartError(res: Response, err: any) {
  if (err instanceof BillingError) {
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }
  console.error('[CartRoutes]', err);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message || 'Cart operation failed' });
}

// GET /api/tenants/me/cart — running billing/usage summary (never a confirmation gate)
cartRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await getCartSummary(req.adminUser!.tenantId!));
  } catch (err: any) {
    handleCartError(res, err);
  }
});

function actorOf(req: Request) {
  return { id: req.adminUser?.id || '', email: req.adminUser?.email || '', role: req.adminUser?.role || 'TENANT_ADMIN' };
}

// POST /api/tenants/me/cart/checkout — "Ready for checkout": returns the hosted Stripe subscription
// screen (card + RBI e-mandate, nothing charged today), or { sandbox: true } outside production
// when Stripe isn't configured. Optional promo code adds its extra trial days.
cartRouter.post('/checkout', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({ promoCode: z.string().trim().max(64).optional().nullable() }).safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    res.json(await startCartCheckout(req.adminUser!.tenantId!, actorOf(req), parsed.data.promoCode));
  } catch (err: any) {
    handleCartError(res, err);
  }
});

// POST /api/tenants/me/cart/card-update — hosted Stripe screen to replace the card.
cartRouter.post('/card-update', async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await startCardUpdate(req.adminUser!.tenantId!, actorOf(req)));
  } catch (err: any) {
    handleCartError(res, err);
  }
});

// POST /api/tenants/me/cart/card-update/complete — return trip of the card-update screen.
cartRouter.post('/card-update/complete', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({ sessionId: z.string().min(1) }).safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    res.json({ ...(await completeCardUpdate(req.adminUser!.tenantId!, parsed.data.sessionId, actorOf(req))), cart: await getCartSummary(req.adminUser!.tenantId!) });
  } catch (err: any) {
    handleCartError(res, err);
  }
});

// POST /api/tenants/me/cart/complete — the return trip from Stripe: adopt the trial subscription and release held mailboxes.
cartRouter.post('/complete', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({ sessionId: z.string().min(1) }).safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const tenantId = req.adminUser!.tenantId!;
  try {
    const result = await completeCartCheckout(tenantId, parsed.data.sessionId, actorOf(req));
    res.json({ ...result, cart: await getCartSummary(tenantId) });
  } catch (err: any) {
    handleCartError(res, err);
  }
});

const activateSchema = z.object({
  paymentMethodId: z.string().optional(),
  brand: z.string().optional(),
  last4: z.string().optional(),
  expMonth: z.number().optional(),
  expYear: z.number().optional(),
});

// POST /api/tenants/me/cart/activate — SANDBOX ONLY (no Stripe, non-production): save a sandbox card,
// start the simulated trial and release every mailbox waiting in the cart. Real activation is
// /checkout → Stripe → /complete.
cartRouter.post('/activate', async (req: Request, res: Response): Promise<void> => {
  const parsed = activateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const tenantId = req.adminUser!.tenantId!;
  try {
    const result = await startTenantTrialWithPayment(tenantId, parsed.data, {
      id: req.adminUser?.id || '',
      email: req.adminUser?.email || '',
      role: req.adminUser?.role || 'TENANT_ADMIN',
    });
    res.json({ ...result, cart: await getCartSummary(tenantId) });
  } catch (err: any) {
    handleCartError(res, err);
  }
});
