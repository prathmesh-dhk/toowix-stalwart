import { runGraceSweepOnce } from './billing-grace-sweep.job';
import { runTrialReminderSweepOnce } from './trial-reminder-sweep.job';
import { runBillingReconciliationOnce } from './billing-reconcile.job';

// Dev-only: run a sweep job once on demand instead of waiting for its interval.
// CLI wrapper: src/scripts/run-job.ts (`npm run job -- <name>`).
// `now` lets a run follow a Stripe test clock instead of the wall clock (reconcile ignores it).
const jobs: Record<string, (now?: Date) => Promise<unknown>> = {
  grace: runGraceSweepOnce,
  trial: runTrialReminderSweepOnce,
  reconcile: runBillingReconciliationOnce,
};

export async function runJob(name: string, now?: Date) {
  if (!Object.hasOwn(jobs, name)) {
    throw new Error(`Unknown job "${name}". Use one of: ${Object.keys(jobs).join(', ')}`);
  }
  return jobs[name](now);
}
