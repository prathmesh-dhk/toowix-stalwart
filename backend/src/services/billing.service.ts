import Stripe from 'stripe';
import { DomainModel, IDomain } from '../db/models/Domain';
import { DomainSubscriptionModel, IDomainSubscription, DomainSubscriptionStatus } from '../db/models/DomainSubscription';
import { TenantModel } from '../db/models/Tenant';
import { PlanModel, IPlan } from '../db/models/Plan';
import { MailboxModel } from '../db/models/Mailbox';
import { stripeClient, meterEventNameForPlan } from '../stripe/client';
import { stalwartClient } from '../stalwart/client';
import { logAudit } from '../audit/service';
import { emailService } from './email.service';
import { config, isBillingEnabled } from '../config';

const TRIAL_DAYS = 60;
const GRACE_DAYS = 7;

export interface BillingActor {
  id: string;
  email: string;
  role: string;
}

export class BillingError extends Error {
  constructor(message: string, public readonly code: string, public readonly statusCode: number = 400) {
    super(message);
    this.name = 'BillingError';
  }
}

async function loadDomainForActor(domainId: string, tenantId: string): Promise<IDomain> {
  const domain = await DomainModel.findOne({ _id: domainId, tenantId });
  if (!domain) throw new BillingError('Domain not found', 'DOMAIN_NOT_FOUND', 404);
  return domain;
}

/**
 * Resolves which Stripe Price a domain's subscription item should use. Licensed (fixed) prices
 * are safe to reuse across every item on a subscription. Metered prices are not — Stripe's
 * Billing Meter aggregates usage by customer only, with no per-item key — so if another domain
 * on this same tenant already occupies the plan's shared metered price, this domain gets its
 * own dedicated Price + Meter instead (see stripeClient.createDedicatedMeteredPrice).
 */
async function resolvePriceForDomainAttachment(
  tenantId: string,
  domain: IDomain,
  plan: IPlan
): Promise<{ priceId: string; dedicatedMeterEventName: string | null }> {
  if (plan.billingMode !== 'metered') {
    return { priceId: await stripeClient.getOrCreatePrice(plan), dedicatedMeterEventName: null };
  }
  const collidesWithSibling = await DomainSubscriptionModel.exists({
    tenantId,
    planId: plan._id,
    domainId: { $ne: domain._id },
    status: { $nin: ['canceled', 'incomplete'] },
  });
  if (!collidesWithSibling) {
    return { priceId: await stripeClient.getOrCreatePrice(plan), dedicatedMeterEventName: null };
  }
  const { priceId, meterEventName } = await stripeClient.createDedicatedMeteredPrice(plan, domain.domainName);
  return { priceId, dedicatedMeterEventName: meterEventName };
}

/**
 * First-time plan selection for a Domain created without one — the domain-setup wizard now
 * creates the domain up front (so it can walk the tenant through DNS setup) and only asks for a
 * plan at the very end, once DNS is configured. Sets the domain's planId/planName/mailboxLimit/
 * employeeCount so mailbox creation's NO_PLAN_SELECTED gate (see mailbox.service.ts) clears, and
 * — mirroring requestUpgrade/requestDowngrade's bypass branch — activates a free subscription row
 * when billing is disabled. Once a domain has a live (non-canceled/incomplete) subscription,
 * further plan changes go through requestUpgrade/requestDowngrade instead.
 */
export async function selectDomainPlan(
  domainId: string,
  tenantId: string,
  planId: string,
  actor: BillingActor
): Promise<IDomain> {
  const domain = await loadDomainForActor(domainId, tenantId);
  const plan = await PlanModel.findOne({ _id: planId, isActive: true });
  if (!plan) throw new BillingError('Plan not found', 'PLAN_NOT_FOUND', 404);

  const existingSub = await DomainSubscriptionModel.findOne({ domainId: domain._id });
  if (existingSub && !['canceled', 'incomplete'].includes(existingSub.status)) {
    throw new BillingError(
      'This domain already has a plan — use upgrade/downgrade to change it',
      'PLAN_ALREADY_SELECTED',
      409
    );
  }

  domain.planId = plan._id as any;
  domain.planName = plan.name;
  domain.mailboxLimit = plan.seatCount;
  domain.employeeCount = plan.seatCount;
  await domain.save();

  if (!isBillingEnabled()) {
    await DomainSubscriptionModel.findOneAndUpdate(
      { domainId: domain._id },
      {
        domainId: domain._id,
        tenantId,
        planId: plan._id,
        status: 'active',
        cancelAtPeriodEnd: false,
      },
      { upsert: true }
    );
  }

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId,
    action: 'DOMAIN_PLAN_SELECTED',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
    metadata: { planId: plan._id.toString(), planName: plan.name, mailboxLimit: plan.seatCount },
  });

  return domain;
}

/**
 * Starts billing for one Domain. Free/skippable step in the domain-setup
 * wizard — the actual hard gate on payment is at first mailbox creation
 * (see mailbox.service.ts).
 *
 * Combined-billing model: every domain under a tenant shares ONE Stripe
 * Subscription (one item per domain), so Stripe bills them as a single
 * invoice per cycle. The tenant's FIRST domain creates that subscription via
 * a real Checkout Session (collects a payment method, starts the 30-day
 * trial). Every domain after that already has a payment method on file, so
 * it skips Checkout entirely and attaches directly as a new item on the
 * existing subscription — no redirect needed. If that subscription is still
 * in its trial window, the new item rides the remainder of it for free
 * (Stripe trials are subscription-level, not per-item); once the
 * subscription has gone active, a newly attached item is prorated and
 * billed immediately. This asymmetry (only the first domain gets a full
 * 30-day trial) is an inherent consequence of one combined subscription,
 * not a bug.
 */
export async function startCheckout(
  domainId: string,
  tenantId: string,
  actor: BillingActor
): Promise<{ url: string } | { attached: true }> {
  const domain = await loadDomainForActor(domainId, tenantId);
  if (!domain.planId) throw new BillingError('This domain has no plan selected', 'NO_PLAN_SELECTED', 400);

  if (!isBillingEnabled()) {
    await DomainSubscriptionModel.findOneAndUpdate(
      { domainId: domain._id },
      {
        domainId: domain._id,
        tenantId,
        planId: domain.planId,
        status: 'active',
        cancelAtPeriodEnd: false,
      },
      { upsert: true }
    );
    return { attached: true };
  }

  const existing = await DomainSubscriptionModel.findOne({ domainId: domain._id });
  if (existing && !['canceled', 'incomplete'].includes(existing.status)) {
    throw new BillingError('This domain already has an active subscription', 'SUBSCRIPTION_EXISTS', 409);
  }

  const [tenant, plan] = await Promise.all([TenantModel.findById(tenantId), PlanModel.findById(domain.planId)]);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);
  if (!plan) throw new BillingError('Plan not found', 'PLAN_NOT_FOUND', 404);

  const priceId = await stripeClient.getOrCreatePrice(plan);
  const quantity = plan.billingMode === 'fixed' ? plan.seatCount : undefined;

  // Does this tenant already have a live subscription via another domain?
  const sibling = await DomainSubscriptionModel.findOne({
    tenantId,
    status: { $nin: ['canceled', 'incomplete'] },
  });

  if (sibling) {
    const attachment = await resolvePriceForDomainAttachment(tenantId, domain, plan);
    const item = await stripeClient.addSubscriptionItem(sibling.stripeSubscriptionId, attachment.priceId, quantity);
    await DomainSubscriptionModel.findOneAndUpdate(
      { domainId: domain._id },
      {
        domainId: domain._id,
        tenantId,
        planId: plan._id,
        stripeSubscriptionId: sibling.stripeSubscriptionId,
        stripeSubscriptionItemId: item.id,
        status: sibling.status,
        currentPeriodEnd: sibling.currentPeriodEnd,
        trialEnd: sibling.trialEnd,
        cancelAtPeriodEnd: false,
        dedicatedStripePriceId: attachment.dedicatedMeterEventName ? attachment.priceId : null,
        dedicatedMeterEventName: attachment.dedicatedMeterEventName,
      },
      { upsert: true }
    );

    await logAudit({
      actorId: actor.id,
      actorRole: actor.role,
      actorEmail: actor.email,
      tenantId,
      action: 'BILLING_DOMAIN_ATTACHED_TO_EXISTING_SUBSCRIPTION',
      resource: 'DOMAIN',
      resourceId: domain._id.toString(),
      metadata: { planId: plan._id.toString(), stripeSubscriptionId: sibling.stripeSubscriptionId },
    });

    return { attached: true };
  }

  const customerId = await stripeClient.getOrCreateCustomer(tenant);
  const session = await stripeClient.createCheckoutSession({
    customerId,
    priceId,
    isMetered: plan.billingMode === 'metered',
    quantity: plan.seatCount,
    trialPeriodDays: TRIAL_DAYS,
    successUrl: `${config.tenantAdminUrl}/billing?checkout=success&domainId=${domain._id}`,
    cancelUrl: `${config.tenantAdminUrl}/billing?checkout=cancelled&domainId=${domain._id}`,
    metadata: { domainId: domain._id.toString(), tenantId, planId: plan._id.toString() },
  });

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId,
    action: 'BILLING_CHECKOUT_STARTED',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
    metadata: { planId: plan._id.toString() },
  });

  if (!session.url) throw new BillingError('Stripe did not return a checkout URL', 'STRIPE_ERROR', 502);
  return { url: session.url };
}

export async function createPaymentMethodSetupIntent(
  domainId: string,
  tenantId: string
): Promise<{ clientSecret: string }> {
  await loadDomainForActor(domainId, tenantId);
  if (!isBillingEnabled()) {
    return { clientSecret: 'bypassed' };
  }
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);

  const customerId = await stripeClient.getOrCreateCustomer(tenant);
  const setupIntent = await stripeClient.createSetupIntent(customerId);
  if (!setupIntent.client_secret) throw new BillingError('Stripe did not return a client secret', 'STRIPE_ERROR', 502);
  return { clientSecret: setupIntent.client_secret };
}

export async function getDomainBillingStatus(domainId: string, tenantId: string) {
  const domain = await loadDomainForActor(domainId, tenantId);
  const sub = await DomainSubscriptionModel.findOne({ domainId: domain._id }).populate('planId');
  if (!sub && !isBillingEnabled()) {
    return {
      domain,
      subscription: {
        domainId: domain._id,
        tenantId,
        planId: domain.planId,
        status: 'active' as DomainSubscriptionStatus,
        currentPeriodEnd: null,
        trialEnd: null,
        gracePeriodEndsAt: null,
        cancelAtPeriodEnd: false,
        pendingDowngradePlanId: null,
      },
    };
  }
  return { domain, subscription: sub };
}

export async function listTenantInvoices(tenantId: string): Promise<Stripe.Invoice[]> {
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant?.stripeCustomerId) return [];
  return stripeClient.listInvoices(tenant.stripeCustomerId);
}

/**
 * Tenant-wide billing summary for the Tenant Home screen: the shared
 * subscription's status/next-charge (read once, off any one sibling row —
 * they're kept in sync by handleWebhookEvent) plus every domain currently
 * on it, for a combined-bill breakdown.
 */
export async function getTenantBillingSummary(tenantId: string): Promise<{
  hasSubscription: boolean;
  status: DomainSubscriptionStatus | null;
  currentPeriodEnd: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  domains: Array<{ domainId: string; domainName: string; planName: string | null; seatCount: number | null }>;
}> {
  const subs = await DomainSubscriptionModel.find({ tenantId, status: { $ne: 'canceled' } })
    .populate('planId')
    .populate('domainId');

  if (subs.length === 0) {
    if (!isBillingEnabled()) {
      const allDomains = await DomainModel.find({ tenantId });
      return {
        hasSubscription: true,
        status: 'active',
        currentPeriodEnd: null,
        trialEnd: null,
        cancelAtPeriodEnd: false,
        domains: allDomains.map((d) => ({
          domainId: d._id.toString(),
          domainName: d.domainName,
          planName: d.planName || null,
          seatCount: d.mailboxLimit || null,
        })),
      };
    }
    return { hasSubscription: false, status: null, currentPeriodEnd: null, trialEnd: null, cancelAtPeriodEnd: false, domains: [] };
  }

  const primary = subs[0];
  return {
    hasSubscription: true,
    status: primary.status,
    currentPeriodEnd: primary.currentPeriodEnd ?? null,
    trialEnd: primary.trialEnd ?? null,
    cancelAtPeriodEnd: primary.cancelAtPeriodEnd,
    domains: subs.map((sub) => {
      const plan = sub.planId as unknown as IPlan | null;
      const domain = sub.domainId as unknown as IDomain | null;
      return {
        domainId: domain?._id?.toString() || sub.domainId.toString(),
        domainName: domain?.domainName || '',
        planName: plan?.name || null,
        seatCount: plan?.seatCount ?? null,
      };
    }),
  };
}

/**
 * Mirrors the tenant-wide suspend cascade in platform-tenant.routes.ts, but
 * scoped to a single domain. Kept as a separate function rather than a
 * refactor of that already-tested route — see billing plan doc.
 */
export async function suspendDomainForNonPayment(domainId: string): Promise<void> {
  const domain = await DomainModel.findByIdAndUpdate(domainId, { status: 'suspended' }, { returnDocument: 'after' });
  if (!domain) return;

  if (domain.stalwartDomainId) {
    try {
      await stalwartClient.updateDomainStatus(domain.stalwartDomainId, false);
    } catch (err: any) {
      console.warn(`[BillingService] Failed to disable Stalwart domain ${domain.stalwartDomainId}:`, err.message);
    }
  }

  const mailboxes = await MailboxModel.find({ domainId: domain._id });
  await MailboxModel.updateMany({ domainId: domain._id }, { status: 'suspended' });
  for (const mailbox of mailboxes) {
    if (mailbox.stalwartAccountId) {
      try {
        await stalwartClient.updateAccountStatus(mailbox.stalwartAccountId, true);
      } catch (err: any) {
        console.warn(`[BillingService] Failed to suspend mailbox account ${mailbox.stalwartAccountId}:`, err.message);
      }
    }
  }

  await logAudit({
    actorRole: 'SYSTEM',
    action: 'DOMAIN_SUSPENDED_NONPAYMENT',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
    tenantId: String(domain.tenantId),
  });
}

export async function reactivateDomainForPayment(domainId: string): Promise<void> {
  const domain = await DomainModel.findByIdAndUpdate(domainId, { status: 'active' }, { returnDocument: 'after' });
  if (!domain) return;

  if (domain.stalwartDomainId) {
    try {
      await stalwartClient.updateDomainStatus(domain.stalwartDomainId, true);
    } catch (err: any) {
      console.warn(`[BillingService] Failed to re-enable Stalwart domain ${domain.stalwartDomainId}:`, err.message);
    }
  }

  const mailboxes = await MailboxModel.find({ domainId: domain._id });
  await MailboxModel.updateMany({ domainId: domain._id }, { status: 'active' });
  for (const mailbox of mailboxes) {
    if (mailbox.stalwartAccountId) {
      try {
        await stalwartClient.updateAccountStatus(mailbox.stalwartAccountId, false);
      } catch (err: any) {
        console.warn(`[BillingService] Failed to reactivate mailbox account ${mailbox.stalwartAccountId}:`, err.message);
      }
    }
  }

  await logAudit({
    actorRole: 'SYSTEM',
    action: 'DOMAIN_REACTIVATED_PAYMENT',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
    tenantId: String(domain.tenantId),
  });
}

/**
 * Reports the running peak mailbox count for a metered domain's current
 * period (see DomainSubscription.peakMailboxCountThisPeriod doc for why
 * this simulates 'max' aggregation on top of Stripe's 'last'-only Meters
 * API). Call after every mailbox create/delete. No-ops for fixed plans.
 */
export async function reportMeteredUsage(domainId: string): Promise<void> {
  if (!isBillingEnabled()) return;
  const sub = await DomainSubscriptionModel.findOne({ domainId });
  if (!sub) return;

  const plan = await PlanModel.findById(sub.planId);
  if (!plan || plan.billingMode !== 'metered') return;

  const tenant = await TenantModel.findById(sub.tenantId);
  if (!tenant?.stripeCustomerId) return;

  const currentCount = await MailboxModel.countDocuments({ domainId });
  const newPeak = Math.max(sub.peakMailboxCountThisPeriod, currentCount);
  sub.peakMailboxCountThisPeriod = newPeak;
  await sub.save();

  try {
    const eventName = sub.dedicatedMeterEventName || meterEventNameForPlan(plan);
    await stripeClient.reportMeteredUsage(eventName, tenant.stripeCustomerId, newPeak);
  } catch (err: any) {
    console.warn(`[BillingService] Failed to report metered usage for domain ${domainId}:`, err.message);
  }
}

export async function requestUpgrade(domainId: string, tenantId: string, newPlanId: string, actor: BillingActor): Promise<void> {
  const domain = await loadDomainForActor(domainId, tenantId);
  const newPlan = await PlanModel.findOne({ _id: newPlanId, isActive: true });
  if (!newPlan) throw new BillingError('Plan not found', 'PLAN_NOT_FOUND', 404);

  if (!isBillingEnabled()) {
    let sub = await DomainSubscriptionModel.findOne({ domainId: domain._id });
    if (!sub) {
      sub = await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: newPlan._id,
        status: 'active',
        cancelAtPeriodEnd: false,
      });
    } else {
      sub.planId = newPlan._id as any;
      await sub.save();
    }
    domain.planId = newPlan._id as any;
    domain.planName = newPlan.name;
    domain.mailboxLimit = newPlan.seatCount;
    domain.employeeCount = newPlan.seatCount;
    await domain.save();

    await logAudit({
      actorId: actor.id,
      actorRole: actor.role,
      actorEmail: actor.email,
      tenantId,
      action: 'BILLING_PLAN_UPGRADED',
      resource: 'DOMAIN',
      resourceId: domain._id.toString(),
      metadata: { newPlanId },
    });
    return;
  }

  const sub = await DomainSubscriptionModel.findOne({ domainId: domain._id });
  if (!sub) throw new BillingError('No active subscription for this domain', 'NO_SUBSCRIPTION', 400);

  const attachment = await resolvePriceForDomainAttachment(tenantId, domain, newPlan);
  await stripeClient.updateSubscriptionItemPrice(
    sub.stripeSubscriptionId,
    sub.stripeSubscriptionItemId,
    attachment.priceId,
    newPlan.billingMode === 'fixed' ? newPlan.seatCount : undefined
  );

  sub.planId = newPlan._id as any;
  sub.dedicatedStripePriceId = attachment.dedicatedMeterEventName ? attachment.priceId : null;
  sub.dedicatedMeterEventName = attachment.dedicatedMeterEventName;
  await sub.save();
  domain.planId = newPlan._id as any;
  domain.planName = newPlan.name;
  domain.mailboxLimit = newPlan.seatCount;
  domain.employeeCount = newPlan.seatCount;
  await domain.save();

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId,
    action: 'BILLING_PLAN_UPGRADED',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
    metadata: { newPlanId },
  });
}

export async function requestDowngrade(domainId: string, tenantId: string, newPlanId: string, actor: BillingActor): Promise<void> {
  const domain = await loadDomainForActor(domainId, tenantId);
  const newPlan = await PlanModel.findOne({ _id: newPlanId, isActive: true });
  if (!newPlan) throw new BillingError('Plan not found', 'PLAN_NOT_FOUND', 404);

  if (!isBillingEnabled()) {
    let sub = await DomainSubscriptionModel.findOne({ domainId: domain._id });
    if (!sub) {
      sub = await DomainSubscriptionModel.create({
        domainId: domain._id,
        tenantId,
        planId: newPlan._id,
        status: 'active',
        cancelAtPeriodEnd: false,
      });
    } else {
      sub.planId = newPlan._id as any;
      sub.pendingDowngradePlanId = null;
      await sub.save();
    }
    domain.planId = newPlan._id as any;
    domain.planName = newPlan.name;
    domain.mailboxLimit = newPlan.seatCount;
    domain.employeeCount = newPlan.seatCount;
    await domain.save();

    await logAudit({
      actorId: actor.id,
      actorRole: actor.role,
      actorEmail: actor.email,
      tenantId,
      action: 'BILLING_PLAN_DOWNGRADE_SCHEDULED',
      resource: 'DOMAIN',
      resourceId: domain._id.toString(),
      metadata: { newPlanId },
    });
    return;
  }

  const sub = await DomainSubscriptionModel.findOne({ domainId: domain._id });
  if (!sub) throw new BillingError('No active subscription for this domain', 'NO_SUBSCRIPTION', 400);

  const newPriceId = await stripeClient.getOrCreatePrice(newPlan);
  await stripeClient.scheduleDowngrade(
    sub.stripeSubscriptionId,
    newPriceId,
    newPlan.billingMode === 'fixed' ? newPlan.seatCount : undefined
  );

  sub.pendingDowngradePlanId = newPlan._id as any;
  await sub.save();

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId,
    action: 'BILLING_PLAN_DOWNGRADE_SCHEDULED',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
    metadata: { newPlanId },
  });
}

/**
 * Cancels this domain's billing. Under the combined-subscription model most
 * domains SHARE a subscription with siblings, so canceling one domain must
 * never take the others down with it: only when this is the LAST domain
 * still attached to that shared subscription does the whole Stripe
 * Subscription get canceled (at period end, as before); otherwise just this
 * domain's own item is detached, leaving the shared subscription and every
 * other domain on it untouched.
 */
export async function cancelSubscription(domainId: string, tenantId: string, actor: BillingActor): Promise<void> {
  const domain = await loadDomainForActor(domainId, tenantId);
  if (!isBillingEnabled()) {
    await DomainSubscriptionModel.deleteOne({ domainId: domain._id });
    await logAudit({
      actorId: actor.id,
      actorRole: actor.role,
      actorEmail: actor.email,
      tenantId,
      action: 'BILLING_CANCEL_REQUESTED',
      resource: 'DOMAIN',
      resourceId: domain._id.toString(),
      metadata: { bypassed: true },
    });
    return;
  }
  const sub = await DomainSubscriptionModel.findOne({ domainId: domain._id });
  if (!sub) throw new BillingError('No active subscription for this domain', 'NO_SUBSCRIPTION', 400);

  const siblingCount = await DomainSubscriptionModel.countDocuments({
    stripeSubscriptionId: sub.stripeSubscriptionId,
    status: { $nin: ['canceled'] },
    domainId: { $ne: domain._id },
  });

  if (siblingCount === 0) {
    await stripeClient.cancelAtPeriodEnd(sub.stripeSubscriptionId, true);
    sub.cancelAtPeriodEnd = true;
    await sub.save();
  } else {
    await stripeClient.removeSubscriptionItem(sub.stripeSubscriptionItemId);
    sub.status = 'canceled';
    sub.cancelAtPeriodEnd = false;
    await sub.save();
  }

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId,
    action: 'BILLING_CANCEL_REQUESTED',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
    metadata: { wasLastDomainOnSubscription: siblingCount === 0 },
  });
}

function mapStripeStatus(status: Stripe.Subscription.Status): DomainSubscriptionStatus {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    default:
      return 'incomplete';
  }
}

async function notifyGraceStarted(sub: IDomainSubscription): Promise<void> {
  const [domain, tenant] = await Promise.all([DomainModel.findById(sub.domainId), TenantModel.findById(sub.tenantId)]);
  if (!domain || !tenant?.contactEmail || !sub.gracePeriodEndsAt) return;
  await emailService.sendBillingGraceStartedEmail({
    to: tenant.contactEmail,
    recipientName: tenant.name,
    domainName: domain.domainName,
    gracePeriodEndsAt: sub.gracePeriodEndsAt,
  });
}

/** Single entry point for every Stripe webhook this app cares about. */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const domainId = session.metadata?.domainId;
      const tenantId = session.metadata?.tenantId;
      const planId = session.metadata?.planId;
      if (!domainId || !tenantId || !planId || !session.subscription) return;

      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
      const subscription = await stripeClient.retrieveSubscription(subscriptionId);
      const item = subscription.items.data[0];
      const plan = await PlanModel.findById(planId);

      // Filtered by {domainId, tenantId}, not {domainId} alone: on the shared platform domain many
      // tenants' subscriptions share one domainId, and a domainId-only filter would match (and
      // overwrite) whichever other tenant's row happened to exist first.
      await DomainSubscriptionModel.findOneAndUpdate(
        { domainId, tenantId },
        {
          domainId,
          tenantId,
          planId,
          stripeSubscriptionId: subscription.id,
          stripeSubscriptionItemId: item.id,
          status: mapStripeStatus(subscription.status),
          currentPeriodEnd: item.current_period_end ? new Date(item.current_period_end * 1000) : null,
          trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          // Unused by an ordinary domain (Domain.mailboxLimit is authoritative there); this is what
          // caps a tenant's own seat count on the shared platform domain.
          mailboxLimit: plan?.seatCount ?? 0,
        },
        { upsert: true, new: true }
      );

      await logAudit({
        actorRole: 'SYSTEM',
        action: 'BILLING_SUBSCRIPTION_STARTED',
        resource: 'DOMAIN',
        resourceId: domainId,
        tenantId,
        metadata: { subscriptionId: subscription.id },
      });
      break;
    }

    // Combined-billing model: every event below carries ONE Stripe
    // subscription id that can be shared by MULTIPLE domains (one per
    // sibling DomainSubscription row) — Stripe reports status/dates at the
    // subscription level, so every handler below applies its update to ALL
    // matching rows, not just one, and cascades any Stalwart-level
    // suspend/reactivate to every domain on that shared subscription.
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const siblings = await DomainSubscriptionModel.find({ stripeSubscriptionId: subscription.id });
      if (siblings.length === 0) return;

      const item = subscription.items.data[0];
      const status = mapStripeStatus(subscription.status);
      const currentPeriodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
      await DomainSubscriptionModel.updateMany(
        { stripeSubscriptionId: subscription.id },
        { status, currentPeriodEnd, cancelAtPeriodEnd: subscription.cancel_at_period_end }
      );
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = (invoice as any).subscription as string | undefined;
      if (!subscriptionId) return;
      const siblings = await DomainSubscriptionModel.find({ stripeSubscriptionId: subscriptionId });
      if (siblings.length === 0) return;

      const gracePeriodEndsAt = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000);
      await DomainSubscriptionModel.updateMany(
        { stripeSubscriptionId: subscriptionId },
        { status: 'grace', gracePeriodEndsAt }
      );
      // One combined bill failed for the whole tenant — every domain on it gets notified.
      for (const sub of siblings) {
        sub.gracePeriodEndsAt = gracePeriodEndsAt;
        await notifyGraceStarted(sub);
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = (invoice as any).subscription as string | undefined;
      if (!subscriptionId) return;
      const siblings = await DomainSubscriptionModel.find({ stripeSubscriptionId: subscriptionId });
      if (siblings.length === 0) return;

      // 'suspended' is included so a late payment after the grace-sweep job
      // already suspended these domains still reactivates them correctly.
      const isRenewal = invoice.billing_reason === 'subscription_cycle';

      for (const sub of siblings) {
        const wasInGrace = sub.status === 'grace' || sub.status === 'past_due' || sub.status === 'suspended';
        sub.status = 'active';
        sub.gracePeriodEndsAt = null;

        // A renewal invoice (not the very first one) starts a fresh usage
        // period for metered plans — reset each domain's own peak tracker
        // to its own current live mailbox count.
        if (isRenewal) {
          const currentCount = await MailboxModel.countDocuments({ domainId: sub.domainId });
          sub.peakMailboxCountThisPeriod = currentCount;
        }
        await sub.save();

        if (wasInGrace) {
          const domain = await DomainModel.findById(sub.domainId);
          if (domain?.status === 'suspended') {
            await reactivateDomainForPayment(sub.domainId.toString());
          }
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const siblings = await DomainSubscriptionModel.find({ stripeSubscriptionId: subscription.id });
      if (siblings.length === 0) return;
      await DomainSubscriptionModel.updateMany({ stripeSubscriptionId: subscription.id }, { status: 'canceled' });
      break;
    }

    default:
      break;
  }
}
