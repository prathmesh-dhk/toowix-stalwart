import Stripe from 'stripe';
import { randomUUID } from 'crypto';
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

  /**
   * Mints a Price + Meter dedicated to one domain's subscription item — used when another
   * domain on the same tenant already occupies the plan's shared metered Price/Meter. Stripe
   * meters aggregate usage by customer only (no per-item key in a meter event's payload), so
   * two subscription items can't safely share one meter. Never cached on the Plan document —
   * it's instance-specific and disposable.
   */
  async createDedicatedMeteredPrice(plan: IPlan, label: string): Promise<{ priceId: string; meterEventName: string }> {
    const stripe = getStripe();
    const meterEventName = `${METER_EVENT_PREFIX}_${plan._id.toString()}_${randomUUID()}`;
    const meter = await stripe.billing.meters.create({
      display_name: `${plan.name} — ${label}`,
      event_name: meterEventName,
      default_aggregation: { formula: 'last' },
      customer_mapping: { event_payload_key: 'stripe_customer_id', type: 'by_id' },
      value_settings: { event_payload_key: 'value' },
    });
    const price = await stripe.prices.create({
      currency: CURRENCY,
      unit_amount: plan.monthlyPriceInPaise,
      recurring: { interval: 'month', usage_type: 'metered', meter: meter.id },
      product_data: { name: `${plan.name} (${label})` },
    });
    return { priceId: price.id, meterEventName };
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

  async listPaymentMethods(customerId: string): Promise<Stripe.PaymentMethod[]> {
    const stripe = getStripe();
    const result = await stripe.paymentMethods.list({ customer: customerId, type: 'card' });
    return result.data;
  }

  async attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    const stripe = getStripe();
    return stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    const stripe = getStripe();
    return stripe.paymentMethods.detach(paymentMethodId);
  }

  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<Stripe.Customer> {
    const stripe = getStripe();
    return stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    }) as Promise<Stripe.Customer>;
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

  /**
   * Attaches a new domain's plan to an already-existing tenant subscription
   * (combined-billing model: every domain under a tenant shares one Stripe
   * Subscription, one item per domain, so Stripe combines them onto a single
   * invoice per cycle). Prorated immediately unless the subscription is
   * still in its trial window, in which case Stripe doesn't invoice at all
   * until the trial ends — the new item rides the remainder of that trial.
   */
  async addSubscriptionItem(subscriptionId: string, priceId: string, quantity?: number): Promise<Stripe.SubscriptionItem> {
    const stripe = getStripe();
    return stripe.subscriptionItems.create({
      subscription: subscriptionId,
      price: priceId,
      quantity,
      proration_behavior: 'create_prorations',
    });
  }

  /**
   * Detaches one domain's item from the shared subscription, leaving the subscription (and
   * every other domain on it) untouched. No proration — the tenant stays billed for this item
   * through the current period's end rather than getting an immediate refund/credit.
   */
  async removeSubscriptionItem(subscriptionItemId: string): Promise<void> {
    const stripe = getStripe();
    await stripe.subscriptionItems.del(subscriptionItemId, { proration_behavior: 'none' });
  }

  /** Immediately cancels a subscription on Stripe. */
  async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const stripe = getStripe();
    return stripe.subscriptions.cancel(subscriptionId);
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
