export class StripeIntegrationError extends Error {
  constructor(message: string, public readonly code: string, public readonly details?: unknown) {
    super(message);
    this.name = 'StripeIntegrationError';
  }
}

export class StripeNotConfiguredError extends StripeIntegrationError {
  constructor() {
    super('Stripe is not configured on this server (STRIPE_SECRET_KEY missing)', 'STRIPE_NOT_CONFIGURED');
  }
}

export class StripeWebhookSignatureError extends StripeIntegrationError {
  constructor(details?: unknown) {
    super('Stripe webhook signature verification failed', 'STRIPE_WEBHOOK_SIGNATURE_INVALID', details);
  }
}
