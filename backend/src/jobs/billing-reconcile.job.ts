import { TenantModel } from '../db/models/Tenant';
import { DomainSubscriptionModel } from '../db/models/DomainSubscription';
import { MailboxModel } from '../db/models/Mailbox';
import { stripeClient } from '../stripe/client';
import { logAudit } from '../audit/service';
import { isBillingEnabled } from '../config';

const TICK_MS = 60 * 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // nightly check

let intervalHandle: NodeJS.Timeout | null = null;
let isReconciling = false;
let lastSweepAt = 0;

export interface ReconciliationResult {
  tenantsChecked: number;
  driftCorrected: number;
}

export async function runBillingReconciliationOnce(): Promise<ReconciliationResult> {
  if (!isBillingEnabled()) return { tenantsChecked: 0, driftCorrected: 0 };
  if (isReconciling) return { tenantsChecked: 0, driftCorrected: 0 };
  isReconciling = true;
  try {
    let tenantsChecked = 0;
    let driftCorrected = 0;

    const tenants = await TenantModel.find({
      stripeSubscriptionId: { $ne: null },
      status: 'active',
    });

    for (const tenant of tenants) {
      if (!tenant.stripeSubscriptionId) continue;
      tenantsChecked++;

      try {
        const sub = await stripeClient.retrieveSubscription(tenant.stripeSubscriptionId);
        for (const item of sub.items.data) {
          const product = item.price?.product;
          const meta = product && typeof product !== 'string' ? (product as any).metadata : undefined;
          const domainId = meta?.domainId;
          if (!domainId) continue;

          const activeCount = await MailboxModel.countDocuments({
            domainId,
            status: 'active',
            billingHold: false,
          });

          if (item.quantity !== activeCount) {
            console.warn(
              `[BillingReconciliation] Drift detected for domain ${domainId}: Stripe qty=${item.quantity}, Mongo active=${activeCount}. Syncing...`
            );
            await stripeClient.syncDomainUserQuantity(item.id, activeCount);
            await DomainSubscriptionModel.updateOne(
              { stripeSubscriptionItemId: item.id },
              { activeUserCount: activeCount }
            );

            await logAudit({
              actorRole: 'SYSTEM',
              action: 'BILLING_RECONCILIATION_FIX',
              resource: 'SUBSCRIPTION_ITEM',
              resourceId: item.id,
              tenantId: tenant._id.toString(),
              metadata: { previousQty: item.quantity, newQty: activeCount, domainId },
            });

            driftCorrected++;
          }
        }
      } catch (err: any) {
        console.warn(`[BillingReconciliation] Failed reconciling tenant ${tenant._id}:`, err.message);
      }
    }

    return { tenantsChecked, driftCorrected };
  } finally {
    isReconciling = false;
  }
}

async function maybeRunSweep(): Promise<void> {
  const dueAt = lastSweepAt + SWEEP_INTERVAL_MS;
  if (Date.now() < dueAt) return;
  lastSweepAt = Date.now();
  await runBillingReconciliationOnce();
}

export function start(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    maybeRunSweep().catch((err) => console.error('[BillingReconciliation] Tick failed:', err));
  }, TICK_MS);
  maybeRunSweep().catch((err) => console.error('[BillingReconciliation] Initial run failed:', err));
}

export function stop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  lastSweepAt = 0;
}
