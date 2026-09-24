import { TenantModel } from '../db/models/Tenant';
import { DomainModel, IDomain } from '../db/models/Domain';
import { PlanModel, IPlan } from '../db/models/Plan';
import { MailboxModel } from '../db/models/Mailbox';
import { AuditLogModel } from '../db/models/AuditLog';
import { HELD_MAILBOX_TTL_DAYS } from './mailbox.service';

export type CartChangeKind =
  | 'USER_ADDED'
  | 'USER_REMOVED'
  | 'USER_SUSPENDED'
  | 'USER_REACTIVATED'
  | 'PLAN_CHANGED';

export interface CartSummary {
  trial: {
    started: boolean;
    startedAt: string | null;
    endsAt: string | null;
    daysRemaining: number;
    isTrialing: boolean;
  };
  hasPaymentMethod: boolean;
  paymentMethod: { brand: string; last4: string } | null;
  /** Mailboxes created before activation — suspended until the tenant confirms a card. */
  requiresActivation: boolean;
  pendingMailboxes: Array<{
    id: string;
    address: string;
    domainId: string;
    domainName: string;
    planName: string | null;
    ratePaise: number;
    createdAt: string;
    expiresAt: string;
  }>;
  domains: Array<{
    domainId: string;
    domainName: string;
    planId: string | null;
    planName: string | null;
    activeUsers: number;
    pendingUsers: number;
    maxUsers: number;
    ratePaise: number;
    monthlyPaise: number;
    users: Array<{ id: string; address: string; status: 'active' | 'suspended'; pendingActivation: boolean }>;
  }>;
  /** Estimated monthly bill once everything (including pending mailboxes) is live. */
  estimatedMonthlyPaise: number;
  /** Estimated monthly bill before the recent changes listed below. */
  previousEstimatedMonthlyPaise: number;
  dueTodayPaise: number;
  recentChanges: Array<{
    id: string;
    at: string;
    kind: CartChangeKind;
    label: string;
    domainName: string | null;
    monthlyDeltaPaise: number;
  }>;
}

const DAY_MS = 86400 * 1000;
const RECENT_WINDOW_DAYS = 30;

function ratePaise(plan: IPlan | null): number {
  return plan?.monthlyPriceInPaise ?? plan?.pricePerUserMonthlyPaise ?? 0;
}

function domainFromAddress(address?: string): string | null {
  const at = address?.lastIndexOf('@') ?? -1;
  return address && at >= 0 ? address.slice(at + 1).toLowerCase() : null;
}

/**
 * The cart is a running billing/usage basket, never an approval gate: users exist the moment they
 * are created. Before the tenant's trial starts, newly created mailboxes are simply held
 * (suspended) and listed here until the tenant confirms a card; afterwards this is purely a live
 * view of usage, the estimated bill, and the billing impact of recent changes.
 */
export async function getCartSummary(tenantId: string): Promise<CartSummary> {
  const tenant = await TenantModel.findById(tenantId);
  const domains = await DomainModel.find({ tenantId }).sort({ isPrimary: -1, createdAt: 1 });
  const plans = new Map<string, IPlan>();
  for (const plan of await PlanModel.find({ _id: { $in: domains.flatMap((d) => (d.planId ? [d.planId] : [])) } })) {
    plans.set(plan._id.toString(), plan);
  }
  const planOf = (d: IDomain): IPlan | null => (d.planId ? plans.get(d.planId.toString()) || null : null);

  const mailboxes = await MailboxModel.find({ tenantId }).select('domainId address status billingHold createdAt');
  const domainNameById = new Map(domains.map((d) => [d._id.toString(), d.domainName]));

  const rows = domains.map((d) => {
    const plan = planOf(d);
    const mine = mailboxes.filter((m) => m.domainId.toString() === d._id.toString());
    const activeUsers = mine.filter((m) => m.status === 'active').length;
    const pendingUsers = mine.filter((m) => m.billingHold).length;
    const rate = ratePaise(plan);
    return {
      domainId: d._id.toString(),
      domainName: d.domainName,
      planId: plan ? plan._id.toString() : null,
      planName: plan?.name || d.planName || null,
      activeUsers,
      pendingUsers,
      maxUsers: plan?.seatCount ?? plan?.maxUsers ?? d.mailboxLimit ?? 10,
      ratePaise: rate,
      monthlyPaise: (activeUsers + pendingUsers) * rate,
      users: mine
        .map((m) => ({ id: m._id.toString(), address: m.address, status: m.status as 'active' | 'suspended', pendingActivation: !!m.billingHold }))
        .sort((a, b) => a.address.localeCompare(b.address)),
    };
  });
  const rateByDomainName = new Map(rows.map((r) => [r.domainName.toLowerCase(), r.ratePaise]));

  const pendingMailboxes = mailboxes
    .filter((m) => m.billingHold)
    .map((m) => {
      const row = rows.find((r) => r.domainId === m.domainId.toString());
      return {
        id: m._id.toString(),
        address: m.address,
        domainId: m.domainId.toString(),
        domainName: domainNameById.get(m.domainId.toString()) || '',
        planName: row?.planName || null,
        ratePaise: row?.ratePaise || 0,
        createdAt: m.createdAt.toISOString(),
        expiresAt: new Date(m.createdAt.getTime() + HELD_MAILBOX_TTL_DAYS * DAY_MS).toISOString(),
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * DAY_MS);
  const logs = await AuditLogModel.find({
    tenantId,
    timestamp: { $gte: since },
    action: {
      $in: ['MAILBOX_CREATED', 'MAILBOX_DELETED', 'MAILBOX_SUSPENDED', 'MAILBOX_REACTIVATED', 'DOMAIN_PLAN_SELECTED', 'BILLING_PLAN_UPGRADED'],
    },
  })
    .sort({ timestamp: -1 })
    .limit(15);

  const recentChanges: CartSummary['recentChanges'] = logs.map((log) => {
    const address: string | undefined = log.metadata?.address;
    const domainName = domainFromAddress(address) || log.metadata?.domainName || null;
    const rate = (domainName && rateByDomainName.get(domainName.toLowerCase())) || 0;
    switch (log.action) {
      case 'MAILBOX_CREATED':
        return { id: String(log._id), at: log.timestamp.toISOString(), kind: 'USER_ADDED', label: `${address} added`, domainName, monthlyDeltaPaise: rate };
      case 'MAILBOX_DELETED':
        return { id: String(log._id), at: log.timestamp.toISOString(), kind: 'USER_REMOVED', label: `${address} removed`, domainName, monthlyDeltaPaise: -rate };
      case 'MAILBOX_SUSPENDED':
        return { id: String(log._id), at: log.timestamp.toISOString(), kind: 'USER_SUSPENDED', label: `${address} suspended`, domainName, monthlyDeltaPaise: -rate };
      case 'MAILBOX_REACTIVATED':
        return { id: String(log._id), at: log.timestamp.toISOString(), kind: 'USER_REACTIVATED', label: `${address} reactivated`, domainName, monthlyDeltaPaise: rate };
      default:
        return {
          id: String(log._id),
          at: log.timestamp.toISOString(),
          kind: 'PLAN_CHANGED',
          label: `${log.metadata?.planName || 'Plan'} selected`,
          domainName: log.metadata?.domainName || null,
          monthlyDeltaPaise: 0,
        };
    }
  });

  const estimatedMonthlyPaise = rows.reduce((sum, r) => sum + r.monthlyPaise, 0);
  const netDelta = recentChanges.reduce((sum, c) => sum + c.monthlyDeltaPaise, 0);
  const now = Date.now();
  const started = !!tenant?.trialStartedAt;
  const endsAt = tenant?.trialEndsAt || null;
  const isTrialing = !!endsAt && endsAt.getTime() > now;
  const card = (tenant?.paymentMethods || []).find((m) => m.isDefault) || (tenant?.paymentMethods || [])[0] || null;

  return {
    trial: {
      started,
      startedAt: tenant?.trialStartedAt ? tenant.trialStartedAt.toISOString() : null,
      endsAt: endsAt ? endsAt.toISOString() : null,
      daysRemaining: isTrialing ? Math.ceil((endsAt!.getTime() - now) / DAY_MS) : 0,
      isTrialing,
    },
    hasPaymentMethod: !!card,
    paymentMethod: card ? { brand: card.brand, last4: card.last4 } : null,
    requiresActivation: !started && pendingMailboxes.length > 0,
    pendingMailboxes,
    domains: rows,
    estimatedMonthlyPaise,
    previousEstimatedMonthlyPaise: Math.max(0, estimatedMonthlyPaise - netDelta),
    dueTodayPaise: 0,
    recentChanges,
  };
}
