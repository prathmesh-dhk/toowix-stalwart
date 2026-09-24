import { DomainSubscriptionModel } from '../db/models/DomainSubscription';
import { DomainModel } from '../db/models/Domain';
import { TenantModel } from '../db/models/Tenant';
import { suspendDomainForNonPayment } from '../services/billing.service';
import { emailService } from '../services/email.service';
import { stripeClient } from '../stripe/client';
import { logAudit } from '../audit/service';
import { isBillingEnabled } from '../config';

/**
 * Suspends any domain whose 7-day grace period (started on a failed
 * payment — see billing.service.ts's 'invoice.payment_failed' handler) has
 * expired without a successful payment.
 * Also schedules grace reminder notices at Day 3 and Day 6, and executes
 * off-session payment retries for failed invoices.
 */

const TICK_MS = 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // check every 15 minutes
const DAY_MS = 24 * 60 * 60 * 1000;

let intervalHandle: NodeJS.Timeout | null = null;
let isSweeping = false;
let lastSweepAt = 0;

export interface GraceSweepResult {
  suspended: number;
  noticesSent: number;
  retriesAttempted: number;
}

export async function runGraceSweepOnce(now = new Date()): Promise<GraceSweepResult> {
  if (!isBillingEnabled()) return { suspended: 0, noticesSent: 0, retriesAttempted: 0 };
  if (isSweeping) return { suspended: 0, noticesSent: 0, retriesAttempted: 0 };
  isSweeping = true;
  try {
    let suspended = 0;
    let noticesSent = 0;
    let retriesAttempted = 0;

    // 1. Process expired grace periods
    const expired = await DomainSubscriptionModel.find({
      status: 'grace',
      gracePeriodEndsAt: { $lt: now },
    });

    for (const sub of expired) {
      await suspendDomainForNonPayment(sub.domainId.toString());
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

    // 2. Schedule Day 3 and Day 6 notices for active grace periods
    const inGrace = await DomainSubscriptionModel.find({
      status: 'grace',
      gracePeriodEndsAt: { $gte: now },
    });

    // Group by tenant to avoid duplicate notices for multi-domain subscriptions
    const byTenant = new Map<string, typeof inGrace>();
    for (const sub of inGrace) {
      const key = sub.tenantId.toString();
      byTenant.set(key, [...(byTenant.get(key) || []), sub]);
    }

    for (const [tenantId, subs] of byTenant) {
      const tenant = await TenantModel.findById(tenantId);
      if (!tenant?.contactEmail) continue;

      const sub = subs[0];
      if (!sub.gracePeriodEndsAt) continue;

      const daysRemaining = (sub.gracePeriodEndsAt.getTime() - now.getTime()) / DAY_MS;
      const sent = sub.graceNoticesSent || [];

      // Day 3 notice (~4 days remaining out of 7)
      if (daysRemaining <= 4.1 && !sent.includes(3)) {
        const domainNames = (await DomainModel.find({ _id: { $in: subs.map((s) => s.domainId) } }))
          .map((d) => d.domainName)
          .join(', ');

        await emailService.sendBillingNoticeEmail({
          to: tenant.contactEmail,
          recipientName: tenant.name,
          subject: `Payment reminder: 4 days left to keep your Toowix mailboxes active`,
          headline: 'Payment Grace Period Reminder',
          previewText: `4 days left to update your payment method before service is paused.`,
          paragraphs: [
            `We were unable to charge your payment method for your domain(s): <strong>${domainNames}</strong>.`,
            `Your email service is currently running normally, but you have <strong>4 days remaining</strong> in your grace period to update your payment details.`,
            `Please update your card in the Billing section of the Tenant Admin portal to avoid any interruption in sending or receiving emails.`,
          ],
        });

        await DomainSubscriptionModel.updateMany(
          { _id: { $in: subs.map((s) => s._id) } },
          { $addToSet: { graceNoticesSent: 3 } }
        );
        noticesSent++;
      }

      // Day 6 notice (~1 day remaining out of 7)
      if (daysRemaining <= 1.1 && !sent.includes(6)) {
        const domainNames = (await DomainModel.find({ _id: { $in: subs.map((s) => s.domainId) } }))
          .map((d) => d.domainName)
          .join(', ');

        await emailService.sendBillingNoticeEmail({
          to: tenant.contactEmail,
          recipientName: tenant.name,
          subject: `Urgent: Final 24 hours to update payment for ${domainNames}`,
          headline: 'Urgent: Service Suspension in 24 Hours',
          previewText: `Final notice: update your payment method today to prevent suspension.`,
          paragraphs: [
            `This is a final notice regarding non-payment for <strong>${domainNames}</strong>.`,
            `Your 7-day grace period expires tomorrow. If valid payment is not received, your email service will be paused.`,
            `To keep your mail service running without disruption, please update your card immediately in Tenant Admin.`,
          ],
        });

        await DomainSubscriptionModel.updateMany(
          { _id: { $in: subs.map((s) => s._id) } },
          { $addToSet: { graceNoticesSent: 6 } }
        );
        noticesSent++;
      }

      // 3. Attempt automated payment retry once per day
      if (sub.lastPaymentFailedInvoiceId) {
        const shouldRetry =
          !sub.lastPaymentRetryAt || now.getTime() - sub.lastPaymentRetryAt.getTime() >= 24 * 60 * 60 * 1000;

        if (shouldRetry) {
          retriesAttempted++;
          try {
            await DomainSubscriptionModel.updateMany(
              { _id: { $in: subs.map((s) => s._id) } },
              { lastPaymentRetryAt: now }
            );
            const paidInvoice = await stripeClient.payInvoice(sub.lastPaymentFailedInvoiceId);
            if (paidInvoice.status === 'paid') {
              // Successfully collected
              await DomainSubscriptionModel.updateMany(
                { _id: { $in: subs.map((s) => s._id) } },
                {
                  status: 'active',
                  gracePeriodEndsAt: null,
                  lastPaymentFailedInvoiceId: null,
                  lastPaymentRetryAt: null,
                  graceNoticesSent: [],
                }
              );
            }
          } catch (retryErr: any) {
            console.warn(`[BillingGraceSweep] Automated invoice retry failed for invoice ${sub.lastPaymentFailedInvoiceId}:`, retryErr.message);
          }
        }
      }
    }

    return { suspended, noticesSent, retriesAttempted };
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
