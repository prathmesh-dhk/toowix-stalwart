import { DomainModel } from '../db/models/Domain';
import { SystemSettingsModel } from '../db/models/SystemSettings';
import { attemptVerification, notifyActivationFailure, saveIfExists } from '../services/domain-activation.service';
import { logAudit } from '../audit/service';

/**
 * Periodically re-verifies domains stuck in 'activating' (DNS propagation
 * can take real time) and flags any that exceed the configured max window
 * as 'activation_failed'. There is no cron/queue library anywhere in this
 * codebase (deliberately minimal dependency list), so this is a plain
 * setInterval ticker with a re-entrancy guard, following the same
 * start()/stop() lifecycle convention as the rest of backend/src/services.
 */

const TICK_MS = 60 * 1000; // check every minute whether a sweep is due
const DEFAULT_MAX_HOURS = 48;
const DEFAULT_SWEEP_MINUTES = 15;

let intervalHandle: NodeJS.Timeout | null = null;
let isSweeping = false;
let lastSweepAt = 0;

async function getConfig(): Promise<{ maxHours: number; sweepMinutes: number }> {
  const settings = await SystemSettingsModel.findOne({ key: 'dns_activation_config' });
  return {
    maxHours: settings?.dnsActivationMaxHours ?? DEFAULT_MAX_HOURS,
    sweepMinutes: settings?.dnsSweepIntervalMinutes ?? DEFAULT_SWEEP_MINUTES,
  };
}

export interface SweepResult {
  checked: number;
  activated: number;
  timedOut: number;
}

/**
 * Runs one sweep pass immediately, regardless of the configured interval.
 * Exported for the manual "Retry / Verify" flow's tests and for direct
 * invocation in tests; start() below is what schedules it periodically.
 */
export async function runSweepOnce(): Promise<SweepResult> {
  if (isSweeping) {
    return { checked: 0, activated: 0, timedOut: 0 };
  }
  isSweeping = true;
  try {
    const { maxHours } = await getConfig();
    const cutoff = new Date(Date.now() - maxHours * 60 * 60 * 1000);
    const domains = await DomainModel.find({ dnsStatus: 'activating' });

    let activated = 0;
    let timedOut = 0;

    for (const domain of domains) {
      if (domain.dnsVerificationStartedAt && domain.dnsVerificationStartedAt < cutoff) {
        domain.dnsStatus = 'activation_failed';
        await saveIfExists(domain);
        await logAudit({
          actorRole: 'SYSTEM',
          action: 'DOMAIN_ACTIVATION_TIMED_OUT',
          resource: 'DOMAIN',
          resourceId: domain._id.toString(),
          tenantId: String(domain.tenantId),
          metadata: { domainName: domain.domainName, maxHours },
          success: false,
        });
        await notifyActivationFailure(domain, 'propagation_timeout');
        timedOut++;
        continue;
      }

      await attemptVerification(domain);
      if (domain.dnsStatus === 'active') activated++;
    }

    return { checked: domains.length, activated, timedOut };
  } finally {
    isSweeping = false;
  }
}

async function maybeRunSweep(): Promise<void> {
  const { sweepMinutes } = await getConfig();
  const dueAt = lastSweepAt + sweepMinutes * 60 * 1000;
  if (Date.now() < dueAt) return;
  lastSweepAt = Date.now();
  await runSweepOnce();
}

export function start(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    maybeRunSweep().catch((err) => console.error('[DnsPropagationSweep] Sweep tick failed:', err));
  }, TICK_MS);
  // Kick off an initial pass shortly after boot rather than waiting a full interval.
  maybeRunSweep().catch((err) => console.error('[DnsPropagationSweep] Initial sweep failed:', err));
}

export function stop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  lastSweepAt = 0;
}
