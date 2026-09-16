import Stripe from 'stripe';
import { config } from '../config';
import { IPlan } from '../db/models/Plan';
import { ITenant } from '../db/models/Tenant';
import { StripeNotConfiguredError, StripeWebhookSignatureError } from './errors';

const CURRENCY = 'inr';
const METER_EVENT_PREFIX = 'mailbox_count';

/** Deterministic per-plan meter event name — recomputed wherever needed, never stored separately. */
export function meterEventNameForPlan(plan: IPlan): string {
  return `${METER_EVENT_PREFIX}_${plan._id.toString()}`;
}

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!config.stripe.secretKey) {
    throw new StripeNotConfiguredError();
  }
  if (!_stripe) {
    _stripe = new Stripe(config.stripe.secretKey);
  }
  return _stripe;
}

export class ToowixStripeClient {
  /** Lazily creates the one shared Billing Meter used by every metered (Custom) plan. */
  async getOrCreateMeter(plan: IPlan): Promise<string> {
    if (plan.stripeMeterId) return plan.stripeMeterId;

    const stripe = getStripe();
    const meter = await stripe.billing.meters.create({
      display_name: `${plan.name} — mailbox count`,
      event_name: meterEventNameForPlan(plan),
      default_aggregation: { formula: 'last' },
      customer_mapping: { event_payload_key: 'stripe_customer_id', type: 'by_id' },
      value_settings: { event_payload_key: 'value' },
    });

    plan.stripeMeterId = meter.id;
    await plan.save();
    return meter.id;
  }

  /** Lazily creates the Stripe Price for a Plan (fixed = licensed/per-seat quantity, metered = usage-based). */
  async getOrCreatePrice(plan: IPlan): Promise<string> {
    if (plan.stripePriceId) return plan.stripePriceId;

    const stripe = getStripe();
    let price: Stripe.Price;

    if (plan.billingMode === 'metered') {
      const meterId = await this.getOrCreateMeter(plan);
      price = await stripe.prices.create({
        currency: CURRENCY,
        unit_amount: plan.monthlyPriceInPaise,
        recurring: { interval: 'month', usage_type: 'metered', meter: meterId },
        product_data: { name: `${plan.name} (pay as you go)` },
      });
    } else {
      price = await stripe.prices.create({
        currency: CURRENCY,
        unit_amount: plan.monthlyPriceInPaise,
        recurring: { interval: 'month', usage_type: 'licensed' },
        product_data: { name: `${plan.name} (${plan.seatCount} seats)` },
      });
    }

    plan.stripePriceId = price.id;
    await plan.save();
    return price.id;
  }

  /** Lazily creates the one Stripe Customer per Tenant. */
  async getOrCreateCustomer(tenant: ITenant): Promise<string> {
    if (tenant.stripeCustomerId) return tenant.stripeCustomerId;

    const stripe = getStripe();
    const customer = await stripe.customers.create({
      name: tenant.name,
      email: tenant.contactEmail || undefined,
      metadata: { toowixTenantId: tenant._id.toString() },
    });

    tenant.stripeCustomerId = customer.id;
    await tenant.save();
    return customer.id;
  }

  async createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    isMetered: boolean;
    quantity: number;
    trialPeriodDays: number;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<Stripe.Checkout.Session> {
    const stripe = getStripe();
    return stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: params.customerId,
      line_items: [
        params.isMetered
          ? { price: params.priceId }
          : { price: params.priceId, quantity: params.quantity },
      ],
      subscription_data: {
        trial_period_days: params.trialPeriodDays,
        metadata: params.metadata,
      },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
  }

  async createSetupIntent(customerId: string): Promise<Stripe.SetupIntent> {
    const stripe = getStripe();
    return stripe.setupIntents.create({ customer: customerId });
  }

  async retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const stripe = getStripe();
    return stripe.subscriptions.retrieve(subscriptionId);
  }

  /** Upgrade: immediate change with standard proration. */
  async updateSubscriptionItemPrice(
    subscriptionId: string,
    subscriptionItemId: string,
    newPriceId: string,
    quantity?: number
  ): Promise<Stripe.Subscription> {
    const stripe = getStripe();
    return stripe.subscriptions.update(subscriptionId, {
      items: [{ id: subscriptionItemId, price: newPriceId, quantity }],
      proration_behavior: 'create_prorations',
    });
  }

  /** Downgrade: schedules the price change to take effect at the current period's end. */
  async scheduleDowngrade(subscriptionId: string, newPriceId: string, quantity: number | undefined): Promise<void> {
    const stripe = getStripe();
    const schedule = await stripe.subscriptionSchedules.create({ from_subscription: subscriptionId });
    const currentPhase = schedule.phases[0];
    const currentPhaseItems = currentPhase.items.map((item) => ({
      price: typeof item.price === 'string' ? item.price : item.price.id,
      quantity: item.quantity,
    }));
    await stripe.subscriptionSchedules.update(schedule.id, {
      phases: [
        { items: currentPhaseItems, start_date: currentPhase.start_date, end_date: currentPhase.end_date },
        { items: [{ price: newPriceId, quantity }] },
      ],
    });
  }

  async cancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<Stripe.Subscription> {
    const stripe = getStripe();
    return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: cancel });
  }

  /** Reports the running peak mailbox count for the period (see DomainSubscription.peakMailboxCountThisPeriod doc). */
  async reportMeteredUsage(eventName: string, stripeCustomerId: string, peakValue: number): Promise<void> {
    const stripe = getStripe();
    await stripe.billing.meterEvents.create({
      event_name: eventName,
      payload: { stripe_customer_id: stripeCustomerId, value: String(peakValue) },
    });
  }

  async listInvoices(customerId: string, limit = 50): Promise<Stripe.Invoice[]> {
    const stripe = getStripe();
    const result = await stripe.invoices.list({ customer: customerId, limit });
    return result.data;
  }

  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    if (!config.stripe.webhookSecret) {
      throw new StripeNotConfiguredError();
    }
    const stripe = getStripe();
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
    } catch (err: any) {
      throw new StripeWebhookSignatureError(err.message);
    }
  }
}

export const stripeClient = new ToowixStripeClient();
