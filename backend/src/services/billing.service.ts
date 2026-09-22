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

/** The one shared platform domain (dhkmail.com) every tenant's own dhkmail subscription points at. */
async function loadSharedDomain(): Promise<IDomain> {
  const domain = await DomainModel.findOne({ domainName: config.platformMailDomain });
  if (!domain) {
    throw new BillingError(
      `Platform identity domain '${config.platformMailDomain}' is not provisioned yet.`,
      'PLATFORM_DOMAIN_MISSING',
      503
    );
  }
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
    const item = await stripeClient.addSubscriptionItem(sibling.stripeSubscriptionId, priceId, quantity);
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
 *
 * `tenantId` is the DomainSubscription row's own tenant — the caller always has it on hand (a
 * webhook/sweep always starts from a subscription row). For an ordinary domain it equals
 * domain.tenantId, so nothing changes. For the shared platform domain (dhkmail), many tenants'
 * subscriptions point at the SAME domainId — acting on {domainId} alone would suspend/reactivate
 * every other tenant's mailboxes on it too, and toggling the Domain's own status/Stalwart domain
 * would take the whole shared domain down for everyone over one tenant's non-payment. So when the
 * domain's real owner differs from the paying tenant, this scopes to that tenant's own mailboxes
 * (ownerTenantId) and never touches the shared Domain document or its Stalwart domain record.
 */
export async function suspendDomainForNonPayment(domainId: string, tenantId: string): Promise<void> {
  const domain = await DomainModel.findById(domainId);
  if (!domain) return;

  const isSharedDomain = domain.tenantId.toString() !== tenantId;
  const mailboxFilter = isSharedDomain ? { domainId: domain._id, ownerTenantId: tenantId } : { domainId: domain._id };

  if (!isSharedDomain) {
    await DomainModel.findByIdAndUpdate(domainId, { status: 'suspended' });
    if (domain.stalwartDomainId) {
      try {
        await stalwartClient.updateDomainStatus(domain.stalwartDomainId, false);
      } catch (err: any) {
        console.warn(`[BillingService] Failed to disable Stalwart domain ${domain.stalwartDomainId}:`, err.message);
      }
    }
  }

  const mailboxes = await MailboxModel.find(mailboxFilter);
  await MailboxModel.updateMany(mailboxFilter, { status: 'suspended' });
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
    tenantId,
  });
}

export async function reactivateDomainForPayment(domainId: string, tenantId: string): Promise<void> {
  const domain = await DomainModel.findById(domainId);
  if (!domain) return;

  const isSharedDomain = domain.tenantId.toString() !== tenantId;
  const mailboxFilter = isSharedDomain ? { domainId: domain._id, ownerTenantId: tenantId } : { domainId: domain._id };

  if (!isSharedDomain) {
    await DomainModel.findByIdAndUpdate(domainId, { status: 'active' });
    if (domain.stalwartDomainId) {
      try {
        await stalwartClient.updateDomainStatus(domain.stalwartDomainId, true);
      } catch (err: any) {
        console.warn(`[BillingService] Failed to re-enable Stalwart domain ${domain.stalwartDomainId}:`, err.message);
      }
    }
  }

  const mailboxes = await MailboxModel.find(mailboxFilter);
  await MailboxModel.updateMany(mailboxFilter, { status: 'active' });
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
    tenantId,
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
    await stripeClient.reportMeteredUsage(meterEventNameForPlan(plan), tenant.stripeCustomerId, newPeak);
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

/**
 * Starts (or attaches) billing for a tenant's OWN seat allowance on the shared platform domain
 * (dhkmail.com). Deliberately not a branch inside startCheckout(): that function's ownership check
 * (loadDomainForActor) can never match the shared domain (it's owned by the platform's system
 * tenant, not the caller), and DomainSubscriptionModel is looked up by {domainId, tenantId} here
 * instead of {domainId} alone, since many tenants share this one domainId. Otherwise mirrors
 * startCheckout's combined-subscription logic exactly: first dhkmail subscription for this tenant
 * opens real Stripe Checkout, a later one (there is only ever one — dhkmail has no per-domain
 * plan tiers beyond this) would attach as a sibling item, same as a second owned domain would.
 */
export async function startSharedDomainCheckout(
  tenantId: string,
  planId: string,
  actor: BillingActor
): Promise<{ url: string } | { attached: true }> {
  const domain = await loadSharedDomain();
  const plan = await PlanModel.findById(planId);
  if (!plan) throw new BillingError('Plan not found', 'PLAN_NOT_FOUND', 404);

  if (!isBillingEnabled()) {
    await DomainSubscriptionModel.findOneAndUpdate(
      { domainId: domain._id, tenantId },
      {
        domainId: domain._id,
        tenantId,
        planId: plan._id,
        status: 'active',
        cancelAtPeriodEnd: false,
        mailboxLimit: plan.seatCount,
      },
      { upsert: true }
    );
    return { attached: true };
  }

  const existing = await DomainSubscriptionModel.findOne({ domainId: domain._id, tenantId });
  if (existing && !['canceled', 'incomplete'].includes(existing.status)) {
    throw new BillingError(`This organisation already has an active ${config.platformMailDomain} subscription`, 'SUBSCRIPTION_EXISTS', 409);
  }

  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);

  const priceId = await stripeClient.getOrCreatePrice(plan);
  const quantity = plan.billingMode === 'fixed' ? plan.seatCount : undefined;

  const sibling = await DomainSubscriptionModel.findOne({ tenantId, status: { $nin: ['canceled', 'incomplete'] } });

  if (sibling) {
    const item = await stripeClient.addSubscriptionItem(sibling.stripeSubscriptionId, priceId, quantity);
    await DomainSubscriptionModel.findOneAndUpdate(
      { domainId: domain._id, tenantId },
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
        mailboxLimit: plan.seatCount,
      },
      { upsert: true }
    );

    await logAudit({
      actorId: actor.id,
      actorRole: actor.role,
      actorEmail: actor.email,
      tenantId,
      action: 'BILLING_DHKMAIL_ATTACHED_TO_EXISTING_SUBSCRIPTION',
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
    action: 'BILLING_DHKMAIL_CHECKOUT_STARTED',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
    metadata: { planId: plan._id.toString() },
  });

  if (!session.url) throw new BillingError('Stripe did not return a checkout URL', 'STRIPE_ERROR', 502);
  return { url: session.url };
}

export async function getSharedDomainBillingStatus(tenantId: string) {
  const domain = await loadSharedDomain();
  const sub = await DomainSubscriptionModel.findOne({ domainId: domain._id, tenantId }).populate('planId');
  if (!sub && !isBillingEnabled()) {
    return {
      domain,
      subscription: null,
    };
  }
  return { domain, subscription: sub };
}

/**
 * Cancels a tenant's OWN dhkmail subscription row — never the shared Domain document, which stays
 * owned by the platform and used by every other tenant. Mirrors cancelSubscription's
 * last-domain-on-the-shared-Stripe-subscription check exactly, just scoped by {domainId, tenantId}
 * instead of {domainId} so it only ever finds this tenant's row.
 */
export async function cancelSharedDomainSubscription(tenantId: string, actor: BillingActor): Promise<void> {
  const domain = await loadSharedDomain();
  if (!isBillingEnabled()) {
    await DomainSubscriptionModel.deleteOne({ domainId: domain._id, tenantId });
    await logAudit({
      actorId: actor.id,
      actorRole: actor.role,
      actorEmail: actor.email,
      tenantId,
      action: 'BILLING_DHKMAIL_CANCEL_REQUESTED',
      resource: 'DOMAIN',
      resourceId: domain._id.toString(),
      metadata: { bypassed: true },
    });
    return;
  }

  const sub = await DomainSubscriptionModel.findOne({ domainId: domain._id, tenantId });
  if (!sub) throw new BillingError(`No active ${config.platformMailDomain} subscription for this organisation`, 'NO_SUBSCRIPTION', 400);

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
    action: 'BILLING_DHKMAIL_CANCEL_REQUESTED',
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
          const isSharedDomain = domain && domain.tenantId.toString() !== sub.tenantId.toString();
          if (domain?.status === 'suspended' || isSharedDomain) {
            await reactivateDomainForPayment(sub.domainId.toString(), sub.tenantId.toString());
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
