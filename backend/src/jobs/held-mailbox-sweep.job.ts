import { MailboxModel } from '../db/models/Mailbox';
import { TenantModel } from '../db/models/Tenant';
import { stalwartClient } from '../stalwart/client';
import { emailService } from '../services/email.service';
import { HELD_MAILBOX_TTL_DAYS } from '../services/mailbox.service';
import { logAudit } from '../audit/service';

/**
 * Mailboxes created before the tenant confirmed a card sit suspended on a billing hold. They are not
 * meant to live forever: a warning goes out at day 10 and anything still unactivated at day 14 is
 * removed (Stalwart account + Mongo row), so card-less signups can't pile up mail-server accounts.
 * Same setInterval + re-entrancy-guard shape as billing-grace-sweep.job.ts.
 */

const TICK_MS = 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const HELD_WARNING_DAY = 10;

let intervalHandle: NodeJS.Timeout | null = null;
let isSweeping = false;
let lastSweepAt = 0;

export interface HeldSweepResult {
  warned: number;
  expired: number;
}

export async function runHeldMailboxSweepOnce(now = new Date()): Promise<HeldSweepResult> {
  if (isSweeping) return { warned: 0, expired: 0 };
  isSweeping = true;
  try {
    let warned = 0;
    let expired = 0;

    const expiredCutoff = new Date(now.getTime() - HELD_MAILBOX_TTL_DAYS * DAY_MS);
    const toExpire = await MailboxModel.find({ billingHold: true, createdAt: { $lte: expiredCutoff } });
    for (const mailbox of toExpire) {
      if (mailbox.stalwartAccountId) {
        try {
          await stalwartClient.deleteAccount(mailbox.stalwartAccountId);
        } catch (err: any) {
          console.warn(`[HeldMailboxSweep] Could not delete ${mailbox.address} in Stalwart:`, err.message);
        }
      }
      await MailboxModel.deleteOne({ _id: mailbox._id });
      await TenantModel.updateOne({ _id: mailbox.tenantId, mailboxCount: { $gt: 0 } }, { $inc: { mailboxCount: -1 } });
      await logAudit({
        actorRole: 'SYSTEM',
        action: 'MAILBOX_HOLD_EXPIRED',
        resource: 'MAILBOX',
        resourceId: mailbox._id.toString(),
        tenantId: mailbox.tenantId.toString(),
        metadata: { address: mailbox.address },
      });
      expired++;
    }

    const warnCutoff = new Date(now.getTime() - HELD_WARNING_DAY * DAY_MS);
    const toWarn = await MailboxModel.find({ billingHold: true, heldNoticeSentAt: null, createdAt: { $lte: warnCutoff } });
    const byTenant = new Map<string, typeof toWarn>();
    for (const mailbox of toWarn) {
      const key = mailbox.tenantId.toString();
      byTenant.set(key, [...(byTenant.get(key) || []), mailbox]);
    }
    for (const [tenantId, mailboxes] of byTenant) {
      const tenant = await TenantModel.findById(tenantId);
      if (tenant?.contactEmail) {
        const soonest = new Date(Math.min(...mailboxes.map((m) => m.createdAt.getTime())) + HELD_MAILBOX_TTL_DAYS * DAY_MS);
        await emailService.sendBillingNoticeEmail({
          to: tenant.contactEmail,
          recipientName: tenant.name,
          subject: `Activate your Toowix mailboxes — ${mailboxes.length} will be removed soon`,
          headline: 'Your mailboxes are waiting for activation',
          previewText: `Confirm your card by ${soonest.toLocaleDateString('en-IN')} to keep them.`,
          paragraphs: [
            `These mailboxes were created but are still suspended because no card has been confirmed: <strong>${mailboxes.map((m) => m.address).join(', ')}</strong>.`,
            `Confirm your card in the Cart before <strong>${soonest.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong> to start your 60-day free trial and switch them on. Nothing is charged today. Unactivated mailboxes are removed after ${HELD_MAILBOX_TTL_DAYS} days.`,
          ],
        });
      }
      await MailboxModel.updateMany({ _id: { $in: mailboxes.map((m) => m._id) } }, { heldNoticeSentAt: now });
      warned += mailboxes.length;
    }

    return { warned, expired };
  } finally {
    isSweeping = false;
  }
}

async function maybeRunSweep(): Promise<void> {
  if (Date.now() < lastSweepAt + SWEEP_INTERVAL_MS) return;
  lastSweepAt = Date.now();
  await runHeldMailboxSweepOnce();
}

export function start(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    maybeRunSweep().catch((err) => console.error('[HeldMailboxSweep] Sweep tick failed:', err));
  }, TICK_MS);
  maybeRunSweep().catch((err) => console.error('[HeldMailboxSweep] Initial sweep failed:', err));
}

export function stop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  lastSweepAt = 0;
}
