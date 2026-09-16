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
import { config } from '../config';

const TRIAL_DAYS = 30;
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
 * Starts a Stripe Checkout subscription for one Domain. Free/skippable step
 * in the domain-setup wizard — the actual hard gate on payment is at first
 * mailbox creation (see mailbox.service.ts).
 */
export async function startCheckout(
  domainId: string,
  tenantId: string,
  actor: BillingActor
): Promise<{ url: string }> {
  const domain = await loadDomainForActor(domainId, tenantId);
  if (!domain.planId) throw new BillingError('This domain has no plan selected', 'NO_PLAN_SELECTED', 400);

  const existing = await DomainSubscriptionModel.findOne({ domainId: domain._id });
  if (existing && !['canceled', 'incomplete'].includes(existing.status)) {
    throw new BillingError('This domain already has an active subscription', 'SUBSCRIPTION_EXISTS', 409);
  }

  const [tenant, plan] = await Promise.all([TenantModel.findById(tenantId), PlanModel.findById(domain.planId)]);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);
  if (!plan) throw new BillingError('Plan not found', 'PLAN_NOT_FOUND', 404);

  const customerId = await stripeClient.getOrCreateCustomer(tenant);
  const priceId = await stripeClient.getOrCreatePrice(plan);

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
  return { domain, subscription: sub };
}

export async function listTenantInvoices(tenantId: string): Promise<Stripe.Invoice[]> {
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant?.stripeCustomerId) return [];
  return stripeClient.listInvoices(tenant.stripeCustomerId);
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
    await stripeClient.reportMeteredUsage(meterEventNameForPlan(plan), tenant.stripeCustomerId, newPeak);
  } catch (err: any) {
    console.warn(`[BillingService] Failed to report metered usage for domain ${domainId}:`, err.message);
  }
}

export async function requestUpgrade(domainId: string, tenantId: string, newPlanId: string, actor: BillingActor): Promise<void> {
  const domain = await loadDomainForActor(domainId, tenantId);
  const sub = await DomainSubscriptionModel.findOne({ domainId: domain._id });
  if (!sub) throw new BillingError('No active subscription for this domain', 'NO_SUBSCRIPTION', 400);

  const newPlan = await PlanModel.findOne({ _id: newPlanId, isActive: true });
  if (!newPlan) throw new BillingError('Plan not found', 'PLAN_NOT_FOUND', 404);

  const newPriceId = await stripeClient.getOrCreatePrice(newPlan);
  await stripeClient.updateSubscriptionItemPrice(
    sub.stripeSubscriptionId,
    sub.stripeSubscriptionItemId,
    newPriceId,
    newPlan.billingMode === 'fixed' ? newPlan.seatCount : undefined
  );

  sub.planId = newPlan._id as any;
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
  const sub = await DomainSubscriptionModel.findOne({ domainId: domain._id });
  if (!sub) throw new BillingError('No active subscription for this domain', 'NO_SUBSCRIPTION', 400);

  const newPlan = await PlanModel.findOne({ _id: newPlanId, isActive: true });
  if (!newPlan) throw new BillingError('Plan not found', 'PLAN_NOT_FOUND', 404);

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

export async function cancelSubscription(domainId: string, tenantId: string, actor: BillingActor): Promise<void> {
  const domain = await loadDomainForActor(domainId, tenantId);
  const sub = await DomainSubscriptionModel.findOne({ domainId: domain._id });
  if (!sub) throw new BillingError('No active subscription for this domain', 'NO_SUBSCRIPTION', 400);

  await stripeClient.cancelAtPeriodEnd(sub.stripeSubscriptionId, true);
  sub.cancelAtPeriodEnd = true;
  await sub.save();

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId,
    action: 'BILLING_CANCEL_REQUESTED',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
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

      await DomainSubscriptionModel.findOneAndUpdate(
        { domainId },
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

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const sub = await DomainSubscriptionModel.findOne({ stripeSubscriptionId: subscription.id });
      if (!sub) return;

      const item = subscription.items.data[0];
      sub.status = mapStripeStatus(subscription.status);
      sub.currentPeriodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
      sub.cancelAtPeriodEnd = subscription.cancel_at_period_end;
      await sub.save();
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = (invoice as any).subscription as string | undefined;
      if (!subscriptionId) return;
      const sub = await DomainSubscriptionModel.findOne({ stripeSubscriptionId: subscriptionId });
      if (!sub) return;

      sub.status = 'grace';
      sub.gracePeriodEndsAt = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000);
      await sub.save();
      await notifyGraceStarted(sub);
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = (invoice as any).subscription as string | undefined;
      if (!subscriptionId) return;
      const sub = await DomainSubscriptionModel.findOne({ stripeSubscriptionId: subscriptionId });
      if (!sub) return;

      // 'suspended' is included so a late payment after the grace-sweep job
      // already suspended the domain still reactivates it correctly.
      const wasInGrace = sub.status === 'grace' || sub.status === 'past_due' || sub.status === 'suspended';
      sub.status = 'active';
      sub.gracePeriodEndsAt = null;

      // A renewal invoice (not the very first one) starts a fresh usage
      // period for metered plans — reset the peak tracker to the domain's
      // current live mailbox count.
      if (invoice.billing_reason === 'subscription_cycle') {
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
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const sub = await DomainSubscriptionModel.findOne({ stripeSubscriptionId: subscription.id });
      if (!sub) return;
      sub.status = 'canceled';
      await sub.save();
      break;
    }

    default:
      break;
  }
}
