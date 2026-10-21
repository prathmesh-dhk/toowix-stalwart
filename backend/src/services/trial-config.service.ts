import { SystemSettingsModel } from '../db/models/SystemSettings';

export type TrialDurationUnit = 'minutes' | 'hours' | 'days';

export interface TrialConfig {
  value: number;
  unit: TrialDurationUnit;
}

const SETTINGS_KEY = 'trial_config';
const DEFAULT_TRIAL: TrialConfig = { value: 60, unit: 'days' };
const UNIT_MS: Record<TrialDurationUnit, number> = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
};
// Stripe refuses trials longer than two years.
const MAX_TRIAL_MS = 730 * UNIT_MS.days;

const isUnit = (u: unknown): u is TrialDurationUnit => u === 'minutes' || u === 'hours' || u === 'days';

export class TrialConfigError extends Error {}

/** The Super Admin's Trial length for new Trials (default 60 days). Running Trials keep their end date. */
export async function getTrialConfig(): Promise<TrialConfig> {
  const settings = await SystemSettingsModel.findOne({ key: SETTINGS_KEY });
  const unit = settings?.trialDurationUnit;
  const value = Number(settings?.trialDurationValue);
  if (!unit || !isUnit(unit) || !Number.isInteger(value) || value < 1) return DEFAULT_TRIAL;
  return { value, unit };
}

export function trialConfigToMs(cfg: TrialConfig): number {
  return cfg.value * UNIT_MS[cfg.unit];
}

export async function getTrialDurationMs(): Promise<number> {
  return trialConfigToMs(await getTrialConfig());
}

export async function updateTrialConfig(data: { value: unknown; unit: unknown }, actorEmail: string): Promise<TrialConfig> {
  const value = Number(data.value);
  const unit = data.unit as TrialDurationUnit;
  if (!isUnit(unit)) throw new TrialConfigError('Unit must be minutes, hours or days');
  if (!Number.isInteger(value) || value < 1) throw new TrialConfigError('Trial length must be a whole number of at least 1');
  if (value * UNIT_MS[unit] > MAX_TRIAL_MS) throw new TrialConfigError('Trial length cannot exceed 730 days');

  await SystemSettingsModel.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: { trialDurationValue: value, trialDurationUnit: unit, updatedBy: actorEmail } },
    { upsert: true }
  );
  return { value, unit };
}
