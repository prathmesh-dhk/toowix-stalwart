import { TenantModel } from '../db/models/Tenant';
import { emailService } from '../services/email.service';
import { getCartSummary } from '../services/cart.service';
import { logAudit } from '../audit/service';

const TICK_MS = 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // check hourly
const DAY_MS = 24 * 60 * 60 * 1000;
export const TRIAL_REMINDER_DAYS = [45, 55, 59];

let intervalHandle: NodeJS.Timeout | null = null;
let isSweeping = false;
let lastSweepAt = 0;

export interface TrialReminderResult {
  reminded: number;
}

export async function runTrialReminderSweepOnce(now = new Date()): Promise<TrialReminderResult> {
  if (isSweeping) return { reminded: 0 };
  isSweeping = true;
  try {
    let reminded = 0;
    const tenants = await TenantModel.find({
      trialStartedAt: { $ne: null },
      status: 'active',
    });

    for (const tenant of tenants) {
      if (!tenant.trialStartedAt || !tenant.contactEmail) continue;

      const elapsedDays = Math.floor((now.getTime() - tenant.trialStartedAt.getTime()) / DAY_MS);
      const totalTrialDays = tenant.trialEndsAt
        ? Math.round((tenant.trialEndsAt.getTime() - tenant.trialStartedAt.getTime()) / DAY_MS)
        : 60;

      const sent = tenant.trialRemindersSent || [];

      for (const milestone of TRIAL_REMINDER_DAYS) {
        if (elapsedDays >= milestone && !sent.includes(milestone)) {
          const daysLeft = Math.max(1, totalTrialDays - elapsedDays);
          const brand = tenant.paymentMethods?.[0]?.brand || 'Card';
          const last4 = tenant.paymentMethods?.[0]?.last4 ? `•••• ${tenant.paymentMethods[0].last4}` : 'on file';

          let estimatedText = '';
          try {
            const summary = await getCartSummary(tenant._id.toString());
            const rs = Math.round(summary.estimatedMonthlyPaise / 100);
            estimatedText = ` Approximately ₹${rs}/month based on your ${tenant.mailboxCount} active user(s).`;
          } catch {
            // fallback if cart summary calculation fails
          }

          await emailService.sendBillingNoticeEmail({
            to: tenant.contactEmail,
            recipientName: tenant.name,
            subject: `Reminder: Your Toowix trial ends in ${daysLeft} days`,
            headline: `Your 60-day free trial ends in ${daysLeft} days`,
            previewText: `Your trial is ending soon. Review your active users and billing details.`,
            paragraphs: [
              `Your 60-day free trial on the Toowix Mail Platform will end in <strong>${daysLeft} days</strong>.`,
              `Once the trial ends, your payment method (${brand} ending in ${last4}) will be charged automatically for your active mailboxes.${estimatedText}`,
              `You can review active mailboxes, add domains, or make changes anytime before the trial ends in the Cart or Billing page in Tenant Admin.`,
            ],
          });

          await TenantModel.updateOne(
            { _id: tenant._id },
            { $addToSet: { trialRemindersSent: milestone } }
          );

          await logAudit({
            actorRole: 'SYSTEM',
            action: 'TRIAL_REMINDER_SENT',
            resource: 'TENANT',
            resourceId: tenant._id.toString(),
            tenantId: tenant._id.toString(),
            metadata: { milestone, daysLeft },
          });

          reminded++;
        }
      }
    }

    return { reminded };
  } finally {
    isSweeping = false;
  }
}

async function maybeRunSweep(): Promise<void> {
  const dueAt = lastSweepAt + SWEEP_INTERVAL_MS;
  if (Date.now() < dueAt) return;
  lastSweepAt = Date.now();
  await runTrialReminderSweepOnce();
}

export function start(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    maybeRunSweep().catch((err) => console.error('[TrialReminderSweep] Sweep tick failed:', err));
  }, TICK_MS);
  maybeRunSweep().catch((err) => console.error('[TrialReminderSweep] Initial sweep failed:', err));
}

export function stop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  lastSweepAt = 0;
}
