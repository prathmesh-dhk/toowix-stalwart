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

  /** Lazily creates the one Stripe Customer per Tenant. */
  async getOrCreateCustomer(tenant: ITenant): Promise<string> {
    if (tenant.stripeCustomerId) return tenant.stripeCustomerId;

    const stripe = getStripe();
    // Keyed per tenant so concurrent requests (a double-clicked checkout) get the same customer back.
    // shortcut: Stripe keeps keys 24h, which only matters if the id is lost from the tenant after that.
    const customer = await stripe.customers.create(
      {
        name: tenant.name,
        email: tenant.contactEmail || undefined,
        metadata: { toowixTenantId: tenant._id.toString() },
      },
      { idempotencyKey: `tenant-customer-${tenant._id.toString()}` }
    );

    tenant.stripeCustomerId = customer.id;
    await tenant.save();
    return customer.id;
  }

  async createActivationCheckoutSession(params: {
    customerId: string;
    lines: Array<{ name: string; unitAmountPaise: number; quantity: number; domainId: string; planId: string }>;
    trialDays: number;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<Stripe.Checkout.Session> {
    const stripe = getStripe();
    return stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: params.customerId,
      payment_method_types: ['card'],
      payment_method_collection: 'always',
      line_items: params.lines.map((l) => ({
        quantity: Math.max(1, l.quantity),
        price_data: {
          currency: CURRENCY,
          unit_amount: l.unitAmountPaise,
          recurring: { interval: 'month' as const },
          product_data: { name: l.name, metadata: { domainId: l.domainId, planId: l.planId } },
        },
      })),
      subscription_data: {
        trial_period_days: params.trialDays,
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
        metadata: params.metadata,
      },
      metadata: params.metadata,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
  }

  /** Hosted Stripe screen to replace the card (setup mode; India mandates are re-registered by Stripe). */
  async createCardUpdateCheckoutSession(params: {
    customerId: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<Stripe.Checkout.Session> {
    const stripe = getStripe();
    return stripe.checkout.sessions.create({
      mode: 'setup',
      customer: params.customerId,
      payment_method_types: ['card'],
      currency: CURRENCY,
      metadata: params.metadata,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
  }

  async retrieveCheckoutSession(sessionId: string, expand: string[] = []): Promise<Stripe.Checkout.Session> {
    const stripe = getStripe();
    return stripe.checkout.sessions.retrieve(sessionId, expand.length ? { expand } : undefined);
  }

  /** Subscription with each item's product (domain/plan metadata) and the default card expanded. */
  async retrieveSubscriptionExpanded(subscriptionId: string): Promise<Stripe.Subscription> {
    const stripe = getStripe();
    return stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price.product', 'default_payment_method'],
    });
  }

  /** Adds one domain to the tenant's subscription with an invoice line that names the domain. */
  async addDomainSubscriptionItem(
    subscriptionId: string,
    params: { name: string; unitAmountPaise: number; quantity: number; domainId: string; planId: string }
  ): Promise<Stripe.SubscriptionItem> {
    const stripe = getStripe();
    const product = await stripe.products.create({
      name: params.name,
      metadata: { domainId: params.domainId, planId: params.planId },
    });
    return stripe.subscriptionItems.create({
      subscription: subscriptionId,
      quantity: Math.max(0, params.quantity),
      proration_behavior: 'create_prorations',
      price_data: {
        currency: CURRENCY,
        unit_amount: params.unitAmountPaise,
        recurring: { interval: 'month' },
        product: product.id,
      },
    });
  }

  /** A licensed per-user price for one domain's item (like addDomainSubscriptionItem's), for plan changes. */
  async createDomainPrice(params: { name: string; unitAmountPaise: number; domainId: string; planId: string }): Promise<string> {
    const stripe = getStripe();
    const product = await stripe.products.create({
      name: params.name,
      metadata: { domainId: params.domainId, planId: params.planId },
    });
    const price = await stripe.prices.create({
      currency: CURRENCY,
      unit_amount: params.unitAmountPaise,
      recurring: { interval: 'month', usage_type: 'licensed' },
      product: product.id,
    });
    return price.id;
  }

  async setSubscriptionDefaultPaymentMethod(subscriptionId: string, paymentMethodId: string): Promise<void> {
    const stripe = getStripe();
    await stripe.subscriptions.update(subscriptionId, { default_payment_method: paymentMethodId });
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

  /**
   * Pending downgrades: from the next period, each item in `pending` (item id → price) moves to
   * its new price. The schedule's phases are rebuilt from the subscription's live items every
   * time, because Stripe applies a phase's own copy of the items when it starts — an upgrade, a
   * new domain or a quantity change made after the copy would be undone. Once nothing is pending,
   * the schedule is released.
   */
  async setPendingPrices(subscriptionId: string, pending: Record<string, string>): Promise<void> {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const attached = typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule?.id;
    const current = subscription.items.data.map((i) => ({ price: i.price.id, quantity: i.quantity }));
    const next = subscription.items.data.map((i, n) => ({ ...current[n], price: pending[i.id] ?? i.price.id }));
    if (next.every((item, n) => item.price === current[n].price)) {
      if (attached) await stripe.subscriptionSchedules.release(attached);
      return;
    }

    // Stripe allows one schedule per subscription; reuse the one attached.
    const schedule = attached
      ? await stripe.subscriptionSchedules.retrieve(attached)
      : await stripe.subscriptionSchedules.create({ from_subscription: subscriptionId });
    const at = Math.max(0, schedule.phases.findIndex((p) => p.start_date === schedule.current_phase?.start_date));
    const currentPhase = schedule.phases[at];
    const itemsOf = (phase: Stripe.SubscriptionSchedule.Phase | undefined) =>
      phase?.items.map((i) => ({ price: typeof i.price === 'string' ? i.price : i.price.id, quantity: i.quantity }));
    // Runs on every subscription update; skip the write (and the update event it makes) when in step.
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (same(itemsOf(currentPhase), current) && same(itemsOf(schedule.phases[at + 1]), next)) return;
    await stripe.subscriptionSchedules.update(schedule.id, {
      phases: [
        { items: current, start_date: currentPhase.start_date, end_date: currentPhase.end_date },
        { items: next },
      ],
    });
  }

  /** Moves a trialing subscription's trial end (coupon extension). Nothing is invoiced for the change. */
  async setTrialEnd(subscriptionId: string, trialEnd: Date): Promise<void> {
    const stripe = getStripe();
    await stripe.subscriptions.update(subscriptionId, {
      trial_end: Math.floor(trialEnd.getTime() / 1000),
      proration_behavior: 'none',
    });
  }

  async cancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<Stripe.Subscription> {
    const stripe = getStripe();
    return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: cancel });
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

  /** Creates a master consolidated subscription for a tenant across one or more domains with a 60-day trial */
  async createMasterTenantSubscription(params: {
    customerId: string;
    items: Array<{ priceId: string; quantity: number; metadata?: Record<string, string> }>;
    trialPeriodDays?: number;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<Stripe.Subscription> {
    const stripe = getStripe();
    return stripe.subscriptions.create(
      {
        customer: params.customerId,
        items: params.items.map((it) => ({
          price: it.priceId,
          quantity: Math.max(0, it.quantity),
          metadata: it.metadata,
        })),
        trial_period_days: params.trialPeriodDays,
        metadata: params.metadata,
        proration_behavior: 'create_prorations',
      },
      params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined
    );
  }

  /** Synchronizes active billable user count as the quantity on a domain's subscription item */
  async syncDomainUserQuantity(subscriptionItemId: string, quantity: number): Promise<Stripe.SubscriptionItem> {
    const stripe = getStripe();
    const qty = Math.max(0, quantity);
    return stripe.subscriptionItems.update(subscriptionItemId, {
      quantity: qty,
      proration_behavior: 'create_prorations',
    });
  }

  async listInvoices(customerId: string, limit = 50): Promise<Stripe.Invoice[]> {
    const stripe = getStripe();
    const result = await stripe.invoices.list({ customer: customerId, limit });
    return result.data;
  }

  /** Attempts payment on an unpaid invoice (used during grace-period retries). */
  async payInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const stripe = getStripe();
    return stripe.invoices.pay(invoiceId);
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
