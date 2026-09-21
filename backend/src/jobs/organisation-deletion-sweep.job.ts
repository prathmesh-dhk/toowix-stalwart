import { expireStaleDeletions } from '../services/organisation-deletion.service';

/**
 * Lapses organisation deletions whose 24-hour OTP window ran out with nobody calling in,
 * so the (suspended) organisation returns to normal without waiting for an admin to log in.
 * Same setInterval + re-entrancy-guard shape as billing-grace-sweep.job.ts.
 */

const TICK_MS = 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

let intervalHandle: NodeJS.Timeout | null = null;
let isSweeping = false;
let lastSweepAt = 0;

export async function runDeletionSweepOnce(): Promise<number> {
  if (isSweeping) return 0;
  isSweeping = true;
  try {
    return await expireStaleDeletions(new Date());
  } finally {
    isSweeping = false;
  }
}

async function maybeRunSweep(): Promise<void> {
  if (Date.now() < lastSweepAt + SWEEP_INTERVAL_MS) return;
  lastSweepAt = Date.now();
  await runDeletionSweepOnce();
}

export function start(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    maybeRunSweep().catch((err) => console.error('[OrganisationDeletionSweep] Sweep tick failed:', err));
  }, TICK_MS);
  maybeRunSweep().catch((err) => console.error('[OrganisationDeletionSweep] Initial sweep failed:', err));
}

export function stop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  lastSweepAt = 0;
}
