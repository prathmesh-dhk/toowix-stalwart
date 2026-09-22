import { DomainSubscriptionModel } from '../db/models/DomainSubscription';
import { suspendDomainForNonPayment } from '../services/billing.service';
import { logAudit } from '../audit/service';
import { isBillingEnabled } from '../config';

/**
 * Suspends any domain whose 7-day grace period (started on a failed
 * payment — see billing.service.ts's 'invoice.payment_failed' handler) has
 * expired without a successful payment. Mirrors dns-propagation-sweep.job.ts's
 * plain setInterval + re-entrancy-guard shape — no cron/queue library in
 * this codebase.
 */

const TICK_MS = 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // check for expired grace periods every 15 minutes

let intervalHandle: NodeJS.Timeout | null = null;
let isSweeping = false;
let lastSweepAt = 0;

export interface GraceSweepResult {
  suspended: number;
}

export async function runGraceSweepOnce(): Promise<GraceSweepResult> {
  if (!isBillingEnabled()) return { suspended: 0 };
  if (isSweeping) return { suspended: 0 };
  isSweeping = true;
  try {
    const now = new Date();
    const expired = await DomainSubscriptionModel.find({
      status: 'grace',
      gracePeriodEndsAt: { $lt: now },
    });

    let suspended = 0;
    for (const sub of expired) {
      await suspendDomainForNonPayment(sub.domainId.toString(), sub.tenantId.toString());
      sub.status = 'suspended';
      await sub.save();
      await logAudit({
        actorRole: 'SYSTEM',
        action: 'DOMAIN_SUSPENDED_GRACE_EXPIRED',
        resource: 'DOMAIN',
        resourceId: sub.domainId.toString(),
        tenantId: sub.tenantId.toString(),
      });
      suspended++;
    }

    return { suspended };
  } finally {
    isSweeping = false;
  }
}

async function maybeRunSweep(): Promise<void> {
  const dueAt = lastSweepAt + SWEEP_INTERVAL_MS;
  if (Date.now() < dueAt) return;
  lastSweepAt = Date.now();
  await runGraceSweepOnce();
}

export function start(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    maybeRunSweep().catch((err) => console.error('[BillingGraceSweep] Sweep tick failed:', err));
  }, TICK_MS);
  maybeRunSweep().catch((err) => console.error('[BillingGraceSweep] Initial sweep failed:', err));
}

export function stop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  lastSweepAt = 0;
}
