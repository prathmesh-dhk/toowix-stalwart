import { useState, useEffect } from 'react';
import { api } from '../api';

export interface TrialLength {
  value: number;
  unit: 'minutes' | 'hours' | 'days';
}

const DEFAULT_TRIAL: TrialLength = { value: 60, unit: 'days' };
const UNIT_SINGULAR = { minutes: 'minute', hours: 'hour', days: 'day' } as const;

// One fetch per page load, shared by every component showing the Trial length.
let cached: Promise<TrialLength> | null = null;

function loadTrialLength(): Promise<TrialLength> {
  if (!cached) {
    cached = Promise.resolve()
      .then(() => api.getBillingConfig())
      .then((cfg) => cfg?.trial || DEFAULT_TRIAL)
      .catch(() => {
        cached = null;
        return DEFAULT_TRIAL;
      });
  }
  return cached;
}

/** "60-day", "2-hour", "30-minute" — for phrases like "your 60-day free trial". */
export function formatTrialLength(t: TrialLength, extraDays = 0): string {
  if (extraDays > 0 && t.unit === 'days') return `${t.value + extraDays}-day`;
  const base = `${t.value}-${UNIT_SINGULAR[t.unit]}`;
  return extraDays > 0 ? `${base} + ${extraDays}-day` : base;
}

/** Label for a Trial that already started — its real span, not today's configured length. */
export function formatTrialSpan(startedAt: string | null, endsAt: string | null): string | null {
  if (!startedAt || !endsAt) return null;
  const minutes = Math.round((new Date(endsAt).getTime() - new Date(startedAt).getTime()) / 60000);
  if (!(minutes > 0)) return null;
  if (minutes % 1440 === 0) return formatTrialLength({ value: minutes / 1440, unit: 'days' });
  if (minutes % 60 === 0) return formatTrialLength({ value: minutes / 60, unit: 'hours' });
  return formatTrialLength({ value: minutes, unit: 'minutes' });
}

/**
 * The Super Admin's configured Trial length (default 60 days), as set in System Operations.
 * Returns the formatted label, e.g. "60-day".
 */
export function useTrialLength(extraDays = 0): string {
  const [trial, setTrial] = useState<TrialLength>(DEFAULT_TRIAL);

  useEffect(() => {
    let alive = true;
    loadTrialLength().then((t) => alive && setTrial(t));
    return () => {
      alive = false;
    };
  }, []);

  return formatTrialLength(trial, extraDays);
}
