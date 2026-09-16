import { PlanModel } from '../db/models/Plan';

const FALLBACK_SEAT_COUNT = 50;

/**
 * Resolves the seat count new tenants get at self-registration / application
 * approval time. Falls back to a fixed default only if no plan has been
 * flagged isDefault yet (should not happen post-seed, but registration must
 * never hard-fail because Super Admin hasn't configured plans).
 */
export async function getDefaultPlanSeatCount(): Promise<number> {
  const defaultPlan = await PlanModel.findOne({ isDefault: true, isActive: true });
  return defaultPlan?.seatCount ?? FALLBACK_SEAT_COUNT;
}
