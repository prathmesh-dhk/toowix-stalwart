import Stripe from 'stripe';
import { DomainModel, IDomain } from '../db/models/Domain';
import { DomainSubscriptionModel, IDomainSubscription, DomainSubscriptionStatus } from '../db/models/DomainSubscription';
import { TenantModel, ITenant } from '../db/models/Tenant';
import { PlanModel, IPlan } from '../db/models/Plan';
import { MailboxModel } from '../db/models/Mailbox';
import { stripeClient, meterEventNameForPlan } from '../stripe/client';
import { stalwartClient } from '../stalwart/client';
import { StalwartDomainExistsError } from '../stalwart/errors';
import { activateDomain, ActivationActor, saveIfExists } from './domain-activation.service';
import { logAudit } from '../audit/service';
import { StripeEventModel } from '../db/models/StripeEvent';
import { couponService } from './coupon.service';
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

/**
 * Real money paths must never silently fall back to the free sandbox in production: if Stripe isn't
 * configured there, refuse instead of activating mailboxes/trials without a payment.
 */
export function assertSandboxOrBilling(): void {
  if (!isBillingEnabled() && config.nodeEnv === 'production') {
    throw new BillingError('Billing is not configured on this server', 'BILLING_NOT_CONFIGURED', 503);
  }
}

/** Stripe moved invoice.subscription to invoice.parent.subscription_details.subscription (2025+ API versions). */
export function subscriptionIdOf(invoice: Stripe.Invoice): string | undefined {
  const legacy = (invoice as any).subscription;
  const legacyId = typeof legacy === 'string' ? legacy : legacy?.id;
  const sub = (invoice as any).parent?.subscription_details?.subscription;
  const parentId = typeof sub === 'string' ? sub : sub?.id;
  return parentId || legacyId || undefined;
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
    // 1. If it's already the exact same plan, treat as idempotent success
    if (
      existingSub.planId?.toString() === plan._id.toString() ||
      domain.planId?.toString() === plan._id.toString()
    ) {
      domain.planId = plan._id as any;
      domain.planName = plan.name;
      domain.mailboxLimit = plan.seatCount;
      domain.employeeCount = plan.seatCount;
      await domain.save();
      return domain;
    }

    // 2. Only reject if the domain already has a live external Stripe subscription.
    // If it has no Stripe subscription yet (e.g. in-wizard setup or simulated dev billing),
    // allow switching plans freely in the wizard before billing is finalized.
    if (existingSub.stripeSubscriptionId && isBillingEnabled()) {
      throw new BillingError(
        'This domain already has a plan — use upgrade/downgrade to change it',
        'PLAN_ALREADY_SELECTED',
        409
      );
    }

    // Update the existing subscription record to the newly selected plan
    existingSub.planId = plan._id as any;
    await existingSub.save();
  }

  domain.planId = plan._id as any;
  domain.planName = plan.name;
  domain.mailboxLimit = plan.seatCount;
  domain.employeeCount = plan.seatCount;
  await domain.save();

  // The tenant's trial may already be running (this is a domain added later) — join it right away.
  await ensureDomainSubscription(domain, actor);

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
    // Real Stripe Checkout is unavailable without billing configured — the saved-card /
    // sandbox-card path (attachDomainWithSavedPayment) is the way to add payment in this mode.
    throw new BillingError('Billing is not configured — add a payment method instead', 'BILLING_NOT_CONFIGURED', 400);
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

export async function createTenantSetupIntent(tenantId: string): Promise<{ clientSecret: string }> {
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

export async function createPaymentMethodSetupIntent(
  domainId: string,
  tenantId: string
): Promise<{ clientSecret: string }> {
  await loadDomainForActor(domainId, tenantId);
  return createTenantSetupIntent(tenantId);
}

export async function listTenantPaymentMethods(tenantId: string): Promise<{
  paymentMethods: Array<{
    id: string;
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
    isDefault: boolean;
  }>;
  defaultPaymentMethodId: string | null;
}> {
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);

  const localMethods = tenant.paymentMethods || [];

  if (isBillingEnabled() && tenant.stripeCustomerId) {
    try {
      const stripeMethods = await stripeClient.listPaymentMethods(tenant.stripeCustomerId);
      if (stripeMethods.length > 0) {
        return {
          paymentMethods: stripeMethods.map((pm, idx) => ({
            id: pm.id,
            brand: pm.card?.brand || 'visa',
            last4: pm.card?.last4 || '4242',
            expMonth: pm.card?.exp_month || 12,
            expYear: pm.card?.exp_year || 2028,
            isDefault: idx === 0,
          })),
          defaultPaymentMethodId: stripeMethods[0]?.id || null,
        };
      }
    } catch (err: any) {
      console.warn('[BillingService] Failed to list Stripe payment methods, falling back to local:', err.message);
    }
  }

  const defaultPm = localMethods.find((m) => m.isDefault) || localMethods[0] || null;
  return {
    paymentMethods: localMethods.map((m) => ({
      id: m.id,
      brand: m.brand,
      last4: m.last4,
      expMonth: m.expMonth,
      expYear: m.expYear,
      isDefault: defaultPm ? defaultPm.id === m.id : false,
    })),
    defaultPaymentMethodId: defaultPm?.id || null,
  };
}

export async function saveTenantPaymentMethod(
  tenantId: string,
  data: {
    paymentMethodId?: string;
    brand?: string;
    last4?: string;
    expMonth?: number;
    expYear?: number;
    isDefault?: boolean;
  }
): Promise<{ success: boolean; paymentMethod: any }> {
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);

  const brand = (data.brand || 'visa').toLowerCase();
  const last4 = data.last4 || '4242';
  const expMonth = data.expMonth || 12;
  const expYear = data.expYear || 2028;
  const pmId = data.paymentMethodId || `pm_sim_${Date.now()}`;

  if (isBillingEnabled()) {
    const customerId = await stripeClient.getOrCreateCustomer(tenant);
    if (data.paymentMethodId && !data.paymentMethodId.startsWith('pm_sim_')) {
      try {
        await stripeClient.attachPaymentMethod(customerId, data.paymentMethodId);
        await stripeClient.setDefaultPaymentMethod(customerId, data.paymentMethodId);
      } catch (err: any) {
        console.warn('[BillingService] Attach payment method to Stripe customer failed:', err.message);
      }
    }
  }

  if (!tenant.paymentMethods) {
    tenant.paymentMethods = [];
  }

  const makeDefault = data.isDefault !== false;
  if (makeDefault) {
    for (const pm of tenant.paymentMethods) {
      pm.isDefault = false;
    }
  }

  const existingIdx = tenant.paymentMethods.findIndex((m) => m.id === pmId || (m.last4 === last4 && m.brand === brand));
  const newPm = {
    id: pmId,
    brand,
    last4,
    expMonth,
    expYear,
    isDefault: makeDefault,
    stripePaymentMethodId: data.paymentMethodId || null,
    createdAt: new Date(),
  };

  if (existingIdx >= 0) {
    tenant.paymentMethods[existingIdx] = newPm as any;
  } else {
    tenant.paymentMethods.push(newPm as any);
  }

  await tenant.save();

  return {
    success: true,
    paymentMethod: newPm,
  };
}

export async function deleteTenantPaymentMethod(tenantId: string, paymentMethodId: string): Promise<{ success: boolean }> {
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);

  if (isBillingEnabled() && !paymentMethodId.startsWith('pm_sim_')) {
    try {
      await stripeClient.detachPaymentMethod(paymentMethodId);
    } catch (err: any) {
      console.warn('[BillingService] Detach payment method error:', err.message);
    }
  }

  tenant.paymentMethods = (tenant.paymentMethods || []).filter((m) => m.id !== paymentMethodId);
  if (tenant.paymentMethods.length > 0 && !tenant.paymentMethods.some((m) => m.isDefault)) {
    tenant.paymentMethods[0].isDefault = true;
  }
  await tenant.save();

  return { success: true };
}

export async function setDefaultPaymentMethod(tenantId: string, paymentMethodId: string): Promise<{ success: boolean }> {
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);

  if (isBillingEnabled() && tenant.stripeCustomerId && !paymentMethodId.startsWith('pm_sim_')) {
    try {
      await stripeClient.setDefaultPaymentMethod(tenant.stripeCustomerId, paymentMethodId);
    } catch (err: any) {
      console.warn('[BillingService] Set default payment method error in Stripe:', err.message);
    }
  }

  for (const pm of tenant.paymentMethods || []) {
    pm.isDefault = pm.id === paymentMethodId;
  }
  await tenant.save();

  return { success: true };
}

/**
 * Runs real domain activation (Stalwart provisioning, DKIM keys, DNS record generation,
 * provider sync/verification — see domain-activation.service.ts) as a side effect of a tenant
 * adding or confirming a payment method for a domain. This replaces the Super Admin's old
 * manual "Activate Domain" button — there is no more approval gate, so activation is triggered
 * the moment payment is confirmed instead. Guarded against domains already active/activating so
 * a retried payment-attach call (or the webhook firing after the synchronous attach already
 * ran) is a safe no-op; failures are logged and swallowed so a DNS/Stalwart hiccup never blocks
 * the billing/subscription result the caller actually needs.
 */
export async function activateDomainOnPayment(domain: IDomain, actor: ActivationActor): Promise<void> {
  try {
    let stalwartDomainId = domain.stalwartDomainId || null;
    if (!stalwartDomainId) {
      const tenant = await TenantModel.findById(domain.tenantId);
      try {
        const created = await stalwartClient.createDomain(domain.domainName, `Tenant: ${tenant?.name || domain.tenantId}`);
        stalwartDomainId = created.id;
      } catch (err: any) {
        if (err instanceof StalwartDomainExistsError) {
          const list = await stalwartClient.listDomains();
          const match = list.find((d) => d.name.toLowerCase() === domain.domainName);
          stalwartDomainId = match?.id || null;
        }
      }
      domain.stalwartDomainId = stalwartDomainId;
    }
    if (stalwartDomainId) {
      try {
        await stalwartClient.updateDomainStatus(stalwartDomainId, true);
      } catch (err: any) {
        console.warn(`[BillingService] Failed to enable Stalwart domain ${stalwartDomainId}:`, err.message);
      }
    }

    try {
      await activateDomain(domain._id.toString(), actor);
    } catch (err: any) {
      console.warn(`[BillingService] DNS sync warning on payment for ${domain._id}:`, err.message);
    }

    // DNS status is whatever activateDomain() honestly left it as (activating / active / conflict) —
    // it is never forced here. Mailbox creation no longer depends on it.
    const reloaded = (await DomainModel.findById(domain._id)) || domain;
    reloaded.status = 'active';
    await saveIfExists(reloaded);
  } catch (err: any) {
    console.warn(`[BillingService] Domain activation on payment failed for ${domain._id}:`, err.message);
  }
}

function isSimulatedSubscriptionId(id?: string | null): boolean {
  return !id || id.startsWith('sub_trial_') || id.startsWith('sub_sim_');
}

function fireAndForgetActivation(domains: IDomain[], actor: ActivationActor): void {
  for (const domain of domains) {
    activateDomainOnPayment(domain, actor).catch((err) =>
      console.warn(`[BillingService] Background activation failed for ${domain._id}:`, err.message)
    );
  }
}

/**
 * Attaches one domain to the tenant's single trial/master subscription. No-op (returns null) until
 * the tenant's trial has started (i.e. a payment method was added at first-user creation), or if
 * the domain has no plan yet. Idempotent — a domain that already has a live subscription is left
 * alone. The domain inherits the TENANT's trial end date: one tenant = one trial.
 */
export async function ensureDomainSubscription(
  domain: IDomain,
  actor: ActivationActor
): Promise<IDomainSubscription | null> {
  const existing = await DomainSubscriptionModel.findOne({ domainId: domain._id });
  if (existing && !['canceled', 'incomplete'].includes(existing.status)) return existing;

  const tenant = await TenantModel.findById(domain.tenantId);
  if (!tenant?.trialStartedAt || !domain.planId) return null;
  const plan = await PlanModel.findById(domain.planId);
  if (!plan) return null;

  const trialEnd = tenant.trialEndsAt || null;
  const status: DomainSubscriptionStatus = trialEnd && trialEnd.getTime() > Date.now() ? 'trialing' : 'active';
  const activeCount = await MailboxModel.countDocuments({ domainId: domain._id, status: 'active' });

  let stripeSubscriptionId = tenant.stripeSubscriptionId || `sub_trial_${tenant._id}`;
  let stripeSubscriptionItemId = `si_trial_${domain._id}`;
  let dedicatedPriceId: string | null = null;
  let dedicatedMeter: string | null = null;

  if (isBillingEnabled() && !isSimulatedSubscriptionId(tenant.stripeSubscriptionId)) {
    stripeSubscriptionId = tenant.stripeSubscriptionId!;
    if (plan.billingMode === 'metered') {
      const attachment = await resolvePriceForDomainAttachment(String(tenant._id), domain, plan);
      const item = await stripeClient.addSubscriptionItem(stripeSubscriptionId, attachment.priceId, activeCount);
      stripeSubscriptionItemId = item.id;
      dedicatedPriceId = attachment.dedicatedMeterEventName ? attachment.priceId : null;
      dedicatedMeter = attachment.dedicatedMeterEventName;
    } else {
      const item = await stripeClient.addDomainSubscriptionItem(stripeSubscriptionId, {
        name: `${plan.name} — ${domain.domainName}`,
        unitAmountPaise: plan.monthlyPriceInPaise ?? plan.pricePerUserMonthlyPaise ?? 0,
        quantity: activeCount,
        domainId: domain._id.toString(),
        planId: plan._id.toString(),
      });
      stripeSubscriptionItemId = item.id;
    }
  }

  const sub = await DomainSubscriptionModel.findOneAndUpdate(
    { domainId: domain._id },
    {
      domainId: domain._id,
      tenantId: tenant._id,
      planId: plan._id,
      stripeSubscriptionId,
      stripeSubscriptionItemId,
      status,
      currentPeriodEnd: trialEnd,
      trialEnd,
      cancelAtPeriodEnd: false,
      activeUserCount: activeCount,
      maxUsers: plan.seatCount ?? plan.maxUsers ?? 10,
      pricePerUserMonthlyPaise: plan.monthlyPriceInPaise ?? plan.pricePerUserMonthlyPaise ?? 0,
      dedicatedStripePriceId: dedicatedPriceId,
      dedicatedMeterEventName: dedicatedMeter,
    },
    { upsert: true, returnDocument: 'after' }
  );

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId: String(tenant._id),
    action: 'BILLING_DOMAIN_ATTACHED_TO_EXISTING_SUBSCRIPTION',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
    metadata: { planId: plan._id.toString(), stripeSubscriptionId },
  });

  fireAndForgetActivation([domain], actor);
  return sub;
}

/**
 * Starts the tenant's ONE 60-day trial (if it hasn't started) and attaches every planned domain to
 * the master subscription. Idempotent: once trialStartedAt is set, the trial dates never move.
 */
const ACTIVATION_LOCK_TTL_MS = 5 * 60 * 1000;

type TrialResult = { trialStartedAt: Date; trialEndsAt: Date; stripeSubscriptionId: string | null; alreadyStarted: boolean };

/**
 * Serialises activation per tenant. The lock is claimed with one atomic update, so two concurrent
 * clicks (or a click racing the Stripe webhook) can never both start a trial; the loser either sees
 * the trial already started or gets a retryable 409.
 */
async function claimActivationLock(tenantId: string): Promise<ITenant | null> {
  return TenantModel.findOneAndUpdate(
    {
      _id: tenantId,
      trialStartedAt: null,
      $or: [{ activationLock: null }, { activationLock: { $lt: new Date(Date.now() - ACTIVATION_LOCK_TTL_MS) } }],
    },
    { $set: { activationLock: new Date() } },
    { returnDocument: 'after' }
  );
}

async function releaseActivationLock(tenantId: string): Promise<void> {
  await TenantModel.updateOne({ _id: tenantId }, { $set: { activationLock: null } });
}

/** Sandbox-only trial start (no Stripe). Real trials are started by Stripe Checkout and adopted below. */
async function startTenantTrial(tenant: ITenant, actor: BillingActor): Promise<TrialResult> {
  if (tenant.trialStartedAt && tenant.trialEndsAt) return startTenantTrialUnlocked(tenant, actor);
  if (isBillingEnabled()) {
    throw new BillingError('Start your trial through Stripe checkout', 'USE_CHECKOUT', 400);
  }

  const claimed = await claimActivationLock(String(tenant._id));
  if (!claimed) {
    const current = await TenantModel.findById(tenant._id);
    if (current?.trialStartedAt && current.trialEndsAt) return startTenantTrialUnlocked(current, actor);
    throw new BillingError('Activation is already in progress — try again in a moment', 'ACTIVATION_IN_PROGRESS', 409);
  }
  try {
    return await startTenantTrialUnlocked(claimed, actor);
  } finally {
    await releaseActivationLock(String(tenant._id));
  }
}

async function startTenantTrialUnlocked(
  tenant: ITenant,
  actor: BillingActor
): Promise<TrialResult> {
  const tenantId = String(tenant._id);
  const domainsWithPlans = await DomainModel.find({ tenantId, planId: { $ne: null } });

  if (tenant.trialStartedAt && tenant.trialEndsAt) {
    for (const domain of domainsWithPlans) await ensureDomainSubscription(domain, actor);
    return {
      trialStartedAt: tenant.trialStartedAt,
      trialEndsAt: tenant.trialEndsAt,
      stripeSubscriptionId: tenant.stripeSubscriptionId || null,
      alreadyStarted: true,
    };
  }

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 86400 * 1000);
  tenant.trialStartedAt = now;
  tenant.trialEndsAt = trialEndsAt;

  tenant.stripeSubscriptionId = `sub_trial_${tenantId}`;

  await tenant.save();
  // Simulated/no-Stripe path (and any domain the Stripe branch skipped) attach through the shared helper.
  for (const domain of domainsWithPlans) await ensureDomainSubscription(domain, actor);
  fireAndForgetActivation(domainsWithPlans, actor);

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId,
    action: 'BILLING_TRIAL_STARTED',
    resource: 'TENANT',
    resourceId: tenantId,
    metadata: {
      trialDays: TRIAL_DAYS,
      domainsCount: domainsWithPlans.length,
      stripeSubscriptionId: tenant.stripeSubscriptionId || 'none',
    },
  });

  return { trialStartedAt: now, trialEndsAt, stripeSubscriptionId: tenant.stripeSubscriptionId || null, alreadyStarted: false };
}

/**
 * Per-domain "payment confirmed" entry point kept for the saved-card path: makes sure the tenant's
 * single trial is running and this domain is attached to it. Never starts a second trial.
 */
export async function attachDomainWithSavedPayment(
  domainId: string,
  tenantId: string,
  actor: BillingActor
): Promise<{ success: boolean; status: string; trialEnd?: Date | null }> {
  const domain = await loadDomainForActor(domainId, tenantId);
  if (!domain.planId) throw new BillingError('This domain has no plan selected', 'NO_PLAN_SELECTED', 400);
  assertSandboxOrBilling();
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);

  const trial = await startTenantTrial(tenant, actor);
  const sub = await ensureDomainSubscription(domain, actor);
  await releaseBillingHolds(tenantId, actor);
  return { success: true, status: sub?.status || 'trialing', trialEnd: trial.trialEndsAt };
}

/**
 * Turns every mailbox held for billing into a live one: un-suspends it in Stalwart, marks it active
 * and refreshes the per-domain billable user counts.
 */
async function releaseBillingHolds(tenantId: string, actor: BillingActor): Promise<number> {
  const held = await MailboxModel.find({ tenantId, billingHold: true });
  const domainIds = new Set<string>();
  for (const mailbox of held) {
    if (mailbox.stalwartAccountId) {
      try {
        await stalwartClient.updateAccountStatus(mailbox.stalwartAccountId, false);
      } catch (err: any) {
        console.warn(`[BillingService] Could not un-suspend ${mailbox.address} in Stalwart:`, err.message);
      }
    }
    mailbox.status = 'active';
    mailbox.billingHold = false;
    await mailbox.save();
    domainIds.add(mailbox.domainId.toString());
    await logAudit({
      actorId: actor.id,
      actorRole: actor.role,
      actorEmail: actor.email,
      tenantId,
      action: 'MAILBOX_ACTIVATED',
      resource: 'MAILBOX',
      resourceId: mailbox._id.toString(),
      metadata: { address: mailbox.address },
    });
  }
  for (const domainId of domainIds) {
    await syncDomainActiveUserCount(domainId).catch((err) =>
      console.warn(`[BillingService] syncDomainActiveUserCount failed for ${domainId}:`, err.message)
    );
  }
  return held.length;
}

/**
 * Sandbox activation (non-production, no Stripe): saves the sandbox card, starts the simulated
 * trial and releases held mailboxes. With Stripe configured, activation goes through Checkout.
 */
export async function startTenantTrialWithPayment(
  tenantId: string,
  paymentData: {
    paymentMethodId?: string;
    brand?: string;
    last4?: string;
    expMonth?: number;
    expYear?: number;
  },
  actor: BillingActor
): Promise<{
  success: boolean;
  trialStartedAt: Date;
  trialEndsAt: Date;
  stripeSubscriptionId: string | null;
  alreadyStarted: boolean;
  activatedMailboxes: number;
}> {
  assertSandboxOrBilling();
  if (isBillingEnabled()) {
    throw new BillingError('Start your trial through Stripe checkout', 'USE_CHECKOUT', 400);
  }
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);

  const alreadySaved = (tenant.paymentMethods || []).some(
    (m) => paymentData.paymentMethodId && m.id === paymentData.paymentMethodId
  );
  const hasCardData = !!(paymentData.paymentMethodId || paymentData.last4);
  if (!alreadySaved && (hasCardData || !(tenant.paymentMethods || []).length)) {
    await saveTenantPaymentMethod(tenantId, { ...paymentData, isDefault: true });
  }

  const fresh = (await TenantModel.findById(tenantId)) as ITenant;
  const trial = await startTenantTrial(fresh, actor);
  const activatedMailboxes = await releaseBillingHolds(tenantId, actor);
  return { success: true, ...trial, activatedMailboxes };
}

/**
 * Cart "Ready for checkout". With Stripe configured this returns the hosted Stripe subscription
 * checkout (card + RBI e-mandate, nothing charged today, one line per domain that has users);
 * without it (non-production) the client falls back to the sandbox card form (`sandbox: true`).
 */
export async function startCartCheckout(
  tenantId: string,
  actor: BillingActor,
  promoCode?: string | null
): Promise<{ url: string } | { sandbox: true }> {
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);
  assertSandboxOrBilling();
  if (!isBillingEnabled()) return { sandbox: true };
  if (tenant.trialStartedAt) throw new BillingError('Your trial has already started', 'ALREADY_ACTIVE', 409);

  const domains = await DomainModel.find({ tenantId, planId: { $ne: null } });
  const lines: Array<{ name: string; unitAmountPaise: number; quantity: number; domainId: string; planId: string }> = [];
  for (const domain of domains) {
    const plan = await PlanModel.findById(domain.planId);
    if (!plan) continue;
    const users = await MailboxModel.countDocuments({ domainId: domain._id, $or: [{ status: 'active' }, { billingHold: true }] });
    if (users === 0) continue;
    lines.push({
      name: `${plan.name} — ${domain.domainName}`,
      unitAmountPaise: plan.monthlyPriceInPaise ?? plan.pricePerUserMonthlyPaise ?? 0,
      quantity: users,
      domainId: domain._id.toString(),
      planId: plan._id.toString(),
    });
  }
  if (lines.length === 0) throw new BillingError('Add at least one user before checkout', 'CART_EMPTY', 400);

  let extraDays = 0;
  const code = promoCode?.trim().toUpperCase() || '';
  if (code) {
    const promo = await couponService.validateCoupon(code, tenantId);
    if (!promo.valid) throw new BillingError(promo.message || 'Invalid promo code', 'INVALID_COUPON', 400);
    extraDays = promo.extraTrialDays || 0;
  }

  const customerId = await stripeClient.getOrCreateCustomer(tenant);
  const session = await stripeClient.createActivationCheckoutSession({
    customerId,
    lines,
    trialDays: TRIAL_DAYS + extraDays,
    successUrl: `${config.tenantAdminUrl}/cart?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${config.tenantAdminUrl}/cart?checkout=cancelled`,
    metadata: { tenantId, purpose: 'cart_activation', promoCode: code, actorId: actor.id },
  });
  if (!session.url) throw new BillingError('Stripe did not return a checkout URL', 'STRIPE_ERROR', 502);
  return { url: session.url };
}

const SYSTEM_ACTOR: BillingActor = { id: 'system', email: 'billing@toowix.internal', role: 'SYSTEM' };

/**
 * Adopts the subscription Stripe created at checkout as the tenant's ONE trial: copies the trial
 * dates and card, upserts a DomainSubscription row per domain line, attaches any other planned
 * domain, releases the held mailboxes and starts DNS activation. Called from both the return trip
 * (/cart/complete) and the checkout.session.completed webhook — whichever lands first wins, the
 * other is a no-op thanks to the activation lock.
 */
export async function adoptActivationSession(tenantId: string, session: Stripe.Checkout.Session, actor: BillingActor) {
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (!subscriptionId) throw new BillingError('Checkout finished without a subscription', 'CARD_CONFIRMATION_FAILED', 402);

  const claimed = await claimActivationLock(tenantId);
  if (!claimed) {
    const current = await TenantModel.findById(tenantId);
    if (current?.trialStartedAt && current.trialEndsAt) {
      const activatedMailboxes = await releaseBillingHolds(tenantId, actor);
      return { success: true, trialStartedAt: current.trialStartedAt, trialEndsAt: current.trialEndsAt, stripeSubscriptionId: current.stripeSubscriptionId || null, alreadyStarted: true, activatedMailboxes };
    }
    throw new BillingError('Activation is already in progress — try again in a moment', 'ACTIVATION_IN_PROGRESS', 409);
  }

  try {
    const subscription = await stripeClient.retrieveSubscriptionExpanded(subscriptionId);
    const trialStartedAt = subscription.trial_start ? new Date(subscription.trial_start * 1000) : new Date();
    const trialEndsAt = subscription.trial_end
      ? new Date(subscription.trial_end * 1000)
      : new Date(trialStartedAt.getTime() + TRIAL_DAYS * 86400 * 1000);

    claimed.stripeSubscriptionId = subscription.id;
    claimed.trialStartedAt = trialStartedAt;
    claimed.trialEndsAt = trialEndsAt;
    await claimed.save();

    const card = subscription.default_payment_method;
    if (card && typeof card !== 'string' && card.card) {
      const fingerprint = (card.card as any).fingerprint;
      if (fingerprint) {
        const prior = await TenantModel.findOne({
          _id: { $ne: claimed._id },
          cardFingerprint: fingerprint,
          trialStartedAt: { $ne: null },
        });
        if (prior) {
          throw new BillingError(
            'This card has already been used for a free trial on another organization. Please use a different card.',
            'TRIAL_ALREADY_USED_FOR_CARD',
            409
          );
        }
        claimed.cardFingerprint = fingerprint;
        await claimed.save();
      }

      await saveTenantPaymentMethod(tenantId, {
        paymentMethodId: card.id,
        brand: card.card.brand,
        last4: card.card.last4,
        expMonth: card.card.exp_month,
        expYear: card.card.exp_year,
        isDefault: true,
      });
    }

    const covered = new Set<string>();
    for (const item of subscription.items.data) {
      const product = item.price?.product;
      const meta = product && typeof product !== 'string' ? (product as Stripe.Product).metadata : undefined;
      const domainId = meta?.domainId;
      const planId = meta?.planId;
      if (!domainId || !planId) continue;
      const plan = await PlanModel.findById(planId);
      await DomainSubscriptionModel.findOneAndUpdate(
        { domainId },
        {
          domainId,
          tenantId,
          planId,
          stripeSubscriptionId: subscription.id,
          stripeSubscriptionItemId: item.id,
          status: 'trialing',
          currentPeriodEnd: trialEndsAt,
          trialEnd: trialEndsAt,
          cancelAtPeriodEnd: false,
          activeUserCount: 0,
          maxUsers: plan?.seatCount ?? plan?.maxUsers ?? 10,
          pricePerUserMonthlyPaise: plan?.monthlyPriceInPaise ?? plan?.pricePerUserMonthlyPaise ?? 0,
        },
        { upsert: true }
      );
      covered.add(domainId);
    }

    await logAudit({
      actorId: actor.id,
      actorRole: actor.role,
      actorEmail: actor.email,
      tenantId,
      action: 'BILLING_TRIAL_STARTED',
      resource: 'TENANT',
      resourceId: tenantId,
      metadata: { trialDays: Math.round((trialEndsAt.getTime() - trialStartedAt.getTime()) / 86400000), stripeSubscriptionId: subscription.id, domainsCount: covered.size },
    });
  } finally {
    await releaseActivationLock(tenantId);
  }

  const tenant = (await TenantModel.findById(tenantId)) as ITenant;
  const planned = await DomainModel.find({ tenantId, planId: { $ne: null } });
  for (const domain of planned) await ensureDomainSubscription(domain, actor);
  const activatedMailboxes = await releaseBillingHolds(tenantId, actor);
  fireAndForgetActivation(planned, actor);

  const promo = session.metadata?.promoCode;
  if (promo) {
    await couponService.redeemCoupon(promo, tenantId, null, actor.id).catch((err: any) =>
      console.warn(`[BillingService] Promo ${promo} could not be recorded:`, err.message)
    );
  }

  return {
    success: true,
    trialStartedAt: tenant.trialStartedAt!,
    trialEndsAt: tenant.trialEndsAt!,
    stripeSubscriptionId: tenant.stripeSubscriptionId || null,
    alreadyStarted: false,
    activatedMailboxes,
  };
}

/** The return trip from Stripe. Idempotent — refreshing the return URL just reports current state. */
export async function completeCartCheckout(tenantId: string, sessionId: string, actor: BillingActor) {
  assertSandboxOrBilling();
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);
  if (!isBillingEnabled()) throw new BillingError('Stripe is not configured', 'BILLING_NOT_CONFIGURED', 400);

  const session = await stripeClient.retrieveCheckoutSession(sessionId);
  if (session.metadata?.tenantId !== tenantId || session.metadata?.purpose !== 'cart_activation') {
    throw new BillingError('This checkout does not belong to your organisation', 'CHECKOUT_MISMATCH', 403);
  }
  if (session.status !== 'complete') {
    throw new BillingError('The card confirmation was not completed', 'CARD_CONFIRMATION_FAILED', 402);
  }
  return adoptActivationSession(tenantId, session, actor);
}

/** "Change payment method": hosted Stripe card screen (or sandbox form outside production). */
export async function startCardUpdate(tenantId: string, actor: BillingActor): Promise<{ url: string } | { sandbox: true }> {
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);
  assertSandboxOrBilling();
  if (!isBillingEnabled()) return { sandbox: true };

  const customerId = await stripeClient.getOrCreateCustomer(tenant);
  const session = await stripeClient.createCardUpdateCheckoutSession({
    customerId,
    successUrl: `${config.tenantAdminUrl}/cart?card=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${config.tenantAdminUrl}/cart?card=cancelled`,
    metadata: { tenantId, purpose: 'card_update', actorId: actor.id },
  });
  if (!session.url) throw new BillingError('Stripe did not return a checkout URL', 'STRIPE_ERROR', 502);
  return { url: session.url };
}

/** Return trip of the card-update screen: makes the new card the default for the customer AND the subscription. */
export async function completeCardUpdate(tenantId: string, sessionId: string, actor: BillingActor): Promise<{ success: true }> {
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);
  assertSandboxOrBilling();
  if (!isBillingEnabled()) throw new BillingError('Stripe is not configured', 'BILLING_NOT_CONFIGURED', 400);

  const session = await stripeClient.retrieveCheckoutSession(sessionId, ['setup_intent.payment_method']);
  if (session.metadata?.tenantId !== tenantId || session.metadata?.purpose !== 'card_update') {
    throw new BillingError('This checkout does not belong to your organisation', 'CHECKOUT_MISMATCH', 403);
  }
  if (session.status !== 'complete') throw new BillingError('The card was not saved', 'CARD_UPDATE_FAILED', 402);

  const intent = session.setup_intent as Stripe.SetupIntent | null;
  const method = intent && typeof intent !== 'string' ? (intent.payment_method as Stripe.PaymentMethod | null) : null;
  if (!method || typeof method === 'string') throw new BillingError('The card was not saved', 'CARD_UPDATE_FAILED', 402);

  const customerId = await stripeClient.getOrCreateCustomer(tenant);
  await stripeClient.setDefaultPaymentMethod(customerId, method.id);
  if (tenant.stripeSubscriptionId && !isSimulatedSubscriptionId(tenant.stripeSubscriptionId)) {
    await stripeClient.setSubscriptionDefaultPaymentMethod(tenant.stripeSubscriptionId, method.id);
  }
  await saveTenantPaymentMethod(tenantId, {
    paymentMethodId: method.id,
    brand: method.card?.brand,
    last4: method.card?.last4,
    expMonth: method.card?.exp_month,
    expYear: method.card?.exp_year,
    isDefault: true,
  });
  await logAudit({
    actorId: actor.id, actorRole: actor.role, actorEmail: actor.email, tenantId,
    action: 'BILLING_CARD_UPDATED', resource: 'TENANT', resourceId: tenantId,
    metadata: { last4: method.card?.last4 || null },
  });
  return { success: true };
}

/**
 * Recalculates the active (billable) user count for a domain's subscription
 * and syncs it to Stripe. Called after mailbox create, delete, suspend, or
 * reactivate to keep the pay-as-you-go quantity current.
 */
export async function syncDomainActiveUserCount(domainId: string): Promise<void> {
  const sub = await DomainSubscriptionModel.findOne({ domainId });
  if (!sub) return;

  const activeCount = await MailboxModel.countDocuments({ domainId, status: 'active' });
  sub.activeUserCount = activeCount;
  await sub.save();

  // Sync to Stripe if billing is enabled and a real subscription item exists
  if (isBillingEnabled() && sub.stripeSubscriptionItemId && !sub.stripeSubscriptionItemId.startsWith('si_trial_')) {
    try {
      await stripeClient.syncDomainUserQuantity(sub.stripeSubscriptionItemId, activeCount);
    } catch (err: any) {
      console.warn(`[BillingService] syncDomainUserQuantity failed for domain ${domainId}:`, err.message);
    }
  }
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
  trialStartedAt: Date | null;
  cancelAtPeriodEnd: boolean;
  totalMonthlyPaise: number;
  domains: Array<{
    domainId: string;
    domainName: string;
    planName: string | null;
    seatCount: number | null;
    activeUserCount: number;
    maxUsers: number;
    pricePerUserMonthlyPaise: number;
    monthlySubtotalPaise: number;
  }>;
}> {
  const tenant = await TenantModel.findById(tenantId);
  const subs = await DomainSubscriptionModel.find({ tenantId, status: { $ne: 'canceled' } })
    .populate('planId')
    .populate('domainId');

  if (subs.length === 0) {
    if (!isBillingEnabled()) {
      const allDomains = await DomainModel.find({ tenantId });
      const domainBreakdown = await Promise.all(
        allDomains.map(async (d) => {
          const plan = d.planId ? await PlanModel.findById(d.planId) : null;
          const activeCount = await MailboxModel.countDocuments({ domainId: d._id, status: 'active' });
          const rate = plan?.monthlyPriceInPaise ?? plan?.pricePerUserMonthlyPaise ?? 0;
          return {
            domainId: d._id.toString(),
            domainName: d.domainName,
            planName: d.planName || plan?.name || null,
            seatCount: d.mailboxLimit || plan?.seatCount || null,
            activeUserCount: activeCount,
            maxUsers: plan?.seatCount ?? plan?.maxUsers ?? 10,
            pricePerUserMonthlyPaise: rate,
            monthlySubtotalPaise: activeCount * rate,
          };
        })
      );
      const trialRunning = !!tenant?.trialStartedAt;
      return {
        hasSubscription: trialRunning,
        status: trialRunning ? 'trialing' : null,
        currentPeriodEnd: null,
        trialEnd: tenant?.trialEndsAt ?? null,
        trialStartedAt: tenant?.trialStartedAt ?? null,
        cancelAtPeriodEnd: false,
        totalMonthlyPaise: domainBreakdown.reduce((sum, d) => sum + d.monthlySubtotalPaise, 0),
        domains: domainBreakdown,
      };
    }
    return {
      hasSubscription: false,
      status: null,
      currentPeriodEnd: null,
      trialEnd: null,
      trialStartedAt: tenant?.trialStartedAt ?? null,
      cancelAtPeriodEnd: false,
      totalMonthlyPaise: 0,
      domains: [],
    };
  }

  const primary = subs[0];
  const domainBreakdown = subs.map((sub) => {
    const plan = sub.planId as unknown as IPlan | null;
    const domain = sub.domainId as unknown as IDomain | null;
    const activeCount = sub.activeUserCount ?? 0;
    const rate = plan?.monthlyPriceInPaise ?? plan?.pricePerUserMonthlyPaise ?? sub.pricePerUserMonthlyPaise ?? 0;
    return {
      domainId: domain?._id?.toString() || sub.domainId.toString(),
      domainName: domain?.domainName || '',
      planName: plan?.name || null,
      seatCount: plan?.seatCount ?? null,
      activeUserCount: activeCount,
      maxUsers: plan?.seatCount ?? plan?.maxUsers ?? sub.maxUsers ?? 10,
      pricePerUserMonthlyPaise: rate,
      monthlySubtotalPaise: activeCount * rate,
    };
  });

  return {
    hasSubscription: true,
    status: primary.status,
    currentPeriodEnd: primary.currentPeriodEnd ?? null,
    trialEnd: primary.trialEnd ?? null,
    trialStartedAt: tenant?.trialStartedAt ?? null,
    cancelAtPeriodEnd: primary.cancelAtPeriodEnd,
    totalMonthlyPaise: domainBreakdown.reduce((sum, d) => sum + d.monthlySubtotalPaise, 0),
    domains: domainBreakdown,
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

/**
 * Cancels the entire tenant master subscription at period end.
 */
export async function cancelTenantSubscription(tenantId: string, actor: BillingActor): Promise<void> {
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);

  if (isBillingEnabled() && tenant.stripeSubscriptionId) {
    await stripeClient.cancelAtPeriodEnd(tenant.stripeSubscriptionId, true);
  }

  await DomainSubscriptionModel.updateMany(
    { tenantId, status: { $nin: ['canceled'] } },
    { cancelAtPeriodEnd: true }
  );

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId,
    action: 'BILLING_TENANT_CANCEL_SCHEDULED',
    resource: 'TENANT',
    resourceId: tenantId,
  });
}

/**
 * Resumes a scheduled cancellation for the tenant master subscription.
 */
export async function resumeTenantSubscription(tenantId: string, actor: BillingActor): Promise<void> {
  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) throw new BillingError('Tenant not found', 'TENANT_NOT_FOUND', 404);

  if (isBillingEnabled() && tenant.stripeSubscriptionId) {
    await stripeClient.cancelAtPeriodEnd(tenant.stripeSubscriptionId, false);
  }

  await DomainSubscriptionModel.updateMany(
    { tenantId, status: { $nin: ['canceled'] } },
    { cancelAtPeriodEnd: false }
  );

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId,
    action: 'BILLING_TENANT_RESUME_SCHEDULED',
    resource: 'TENANT',
    resourceId: tenantId,
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

/**
 * Single entry point for every Stripe webhook this app cares about. Idempotent: an event id is
 * recorded before it is handled, a redelivery is skipped, and a handler failure releases the id so
 * Stripe's retry can run it again.
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  if (event.id) {
    try {
      await StripeEventModel.create({ eventId: event.id, type: event.type });
    } catch (err: any) {
      if (err?.code === 11000) return;
      throw err;
    }
  }
  try {
    await processWebhookEvent(event);
  } catch (err) {
    if (event.id) await StripeEventModel.deleteOne({ eventId: event.id }).catch(() => undefined);
    throw err;
  }
}

async function processWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.purpose === 'cart_activation' && session.metadata.tenantId) {
        await adoptActivationSession(session.metadata.tenantId, session, SYSTEM_ACTOR);
        break;
      }
      if (session.metadata?.purpose === 'card_update' && session.metadata.tenantId) {
        await completeCardUpdate(session.metadata.tenantId, session.id, SYSTEM_ACTOR);
        break;
      }
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

      // Real Stripe Checkout redirect path: the tenant just confirmed a payment method, exactly
      // like the "use saved card" path in attachDomainWithSavedPayment — activate the domain the
      // same way, since this webhook is the only place that path's payment confirmation lands.
      const domainForActivation = await DomainModel.findById(domainId);
      if (domainForActivation) {
        domainForActivation.status = 'active';
        await domainForActivation.save();
        await activateDomainOnPayment(domainForActivation, {
          id: 'system',
          email: 'billing@toowix.internal',
          role: 'SYSTEM',
        });
      }
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

      const status = mapStripeStatus(subscription.status);
      await DomainSubscriptionModel.updateMany(
        { stripeSubscriptionId: subscription.id },
        { status, cancelAtPeriodEnd: subscription.cancel_at_period_end }
      );
      // Every item (one per domain) carries its own period end; update each row from its own item.
      for (const item of subscription.items.data) {
        if (!item.current_period_end) continue;
        await DomainSubscriptionModel.updateOne(
          { stripeSubscriptionId: subscription.id, stripeSubscriptionItemId: item.id },
          { currentPeriodEnd: new Date(item.current_period_end * 1000) }
        );
      }
      break;
    }

    case 'customer.subscription.trial_will_end': {
      const subscription = event.data.object as Stripe.Subscription;
      const tenant = await TenantModel.findOne({ stripeSubscriptionId: subscription.id });
      if (tenant?.contactEmail) {
        const daysLeft = subscription.trial_end
          ? Math.max(1, Math.ceil((subscription.trial_end * 1000 - Date.now()) / (24 * 60 * 60 * 1000)))
          : 3;
        const brand = tenant.paymentMethods?.[0]?.brand || 'Card';
        const last4 = tenant.paymentMethods?.[0]?.last4 ? `•••• ${tenant.paymentMethods[0].last4}` : 'on file';
        await emailService.sendBillingNoticeEmail({
          to: tenant.contactEmail,
          recipientName: tenant.name,
          subject: `Your Toowix 60-day free trial ends in ${daysLeft} days`,
          headline: 'Your free trial is coming to an end',
          previewText: `Your trial ends in ${daysLeft} days. Your card will be billed for your active users.`,
          paragraphs: [
            `Your 60-day free trial on the Toowix Mail Platform will end in <strong>${daysLeft} days</strong>.`,
            `Your payment method (${brand} ending in ${last4}) will be charged automatically for your active mailboxes at the end of the trial.`,
            `You can review your active users, adjust your plans, or remove mailboxes anytime before then from the Cart or Billing tab in Tenant Admin.`,
          ],
        });
      }
      break;
    }

    case 'invoice.payment_action_required': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = subscriptionIdOf(invoice);
      const tenant = subscriptionId ? await TenantModel.findOne({ stripeSubscriptionId: subscriptionId }) : null;
      if (tenant?.contactEmail) {
        const hostedUrl = (invoice as any).hosted_invoice_url;
        await emailService.sendBillingNoticeEmail({
          to: tenant.contactEmail,
          recipientName: tenant.name,
          subject: 'Payment authorization required for your Toowix subscription',
          headline: 'Action required: approve your payment',
          previewText: 'Your bank requires additional authentication for your recurring subscription.',
          paragraphs: [
            'Your bank requires additional verification (such as OTP or 3D Secure) to process your Toowix subscription invoice.',
            hostedUrl
              ? `Please authorize the payment by visiting the secure payment link: <a href="${hostedUrl}" target="_blank">Complete Payment Verification</a>.`
              : 'Please log in to your bank app or check your SMS for the authentication prompt.',
            'Your email service will remain active during the 7-day grace period, but please complete this verification promptly to prevent any disruption.',
          ],
        });
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = subscriptionIdOf(invoice);
      if (!subscriptionId) return;
      const siblings = await DomainSubscriptionModel.find({ stripeSubscriptionId: subscriptionId });
      if (siblings.length === 0) return;

      const gracePeriodEndsAt = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000);
      await DomainSubscriptionModel.updateMany(
        { stripeSubscriptionId: subscriptionId },
        {
          status: 'grace',
          gracePeriodEndsAt,
          lastPaymentFailedInvoiceId: invoice.id || null,
          $addToSet: { graceNoticesSent: 0 },
        }
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
      const subscriptionId = subscriptionIdOf(invoice);
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
        sub.lastPaymentFailedInvoiceId = null;
        sub.lastPaymentRetryAt = null;
        sub.graceNoticesSent = [];

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
      const retentionEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await DomainSubscriptionModel.updateMany(
        { stripeSubscriptionId: subscription.id },
        { status: 'canceled', retentionEndsAt }
      );
      break;
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      await logAudit({
        actorRole: 'SYSTEM',
        action: 'STRIPE_CHARGE_REFUNDED',
        resource: 'BILLING',
        resourceId: charge.id,
        metadata: { amount: charge.amount_refunded, currency: charge.currency },
      });
      break;
    }

    case 'credit_note.created': {
      const creditNote = event.data.object as Stripe.CreditNote;
      await logAudit({
        actorRole: 'SYSTEM',
        action: 'STRIPE_CREDIT_NOTE_CREATED',
        resource: 'BILLING',
        resourceId: creditNote.id,
        metadata: { amount: creditNote.amount, reason: creditNote.reason },
      });
      break;
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute;
      await logAudit({
        actorRole: 'SYSTEM',
        action: 'STRIPE_DISPUTE_CREATED',
        resource: 'BILLING',
        resourceId: dispute.id,
        metadata: { amount: dispute.amount, reason: dispute.reason },
      });
      break;
    }

    default:
      break;
  }
}
