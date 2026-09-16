import { Router, Request, Response } from 'express';
import express from 'express';
import { stripeClient } from '../stripe/client';
import { handleWebhookEvent } from '../services/billing.service';
import { StripeWebhookSignatureError, StripeNotConfiguredError } from '../stripe/errors';

// Mounted BEFORE app.use(express.json()) in app.ts — Stripe's signature
// verification needs the exact raw request body, not a re-serialized
// parsed-then-stringified copy.
export const stripeWebhookRouter = Router();

stripeWebhookRouter.post(
  '/',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      res.status(400).json({ error: 'MISSING_SIGNATURE' });
      return;
    }

    try {
      const event = stripeClient.constructWebhookEvent(req.body, signature);
      await handleWebhookEvent(event);
      res.json({ received: true });
    } catch (err: any) {
      if (err instanceof StripeWebhookSignatureError) {
        res.status(400).json({ error: err.code, message: err.message });
        return;
      }
      if (err instanceof StripeNotConfiguredError) {
        res.status(503).json({ error: err.code, message: err.message });
        return;
      }
      console.error('[StripeWebhook] Handler error:', err);
      // 500 tells Stripe to retry delivery — appropriate for a transient failure.
      res.status(500).json({ error: 'WEBHOOK_HANDLER_ERROR', message: err.message });
    }
  }
);
