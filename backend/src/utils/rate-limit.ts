import { RateLimitEntryModel } from '../db/models/RateLimitEntry';

/**
 * Atomically increments (or starts a fresh window for) one rate-limit key,
 * backed by MongoDB so counts survive backend restarts/redeploys and work
 * correctly across multiple replicas — unlike an in-memory Map.
 *
 * Uses a single findOneAndUpdate with an aggregation-pipeline update so the
 * "increment within the current window, or reset to 1 for a new window" is
 * one atomic operation: two concurrent requests for the same key can never
 * both read count=N and both write N+1, which a naive read-then-write
 * (findOne, mutate, save) would allow.
 */
export async function checkAndIncrementRateLimit(
  key: string,
  windowMs: number,
  maxAttempts: number
): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
  const now = new Date();
  const newResetAt = new Date(now.getTime() + windowMs);

  const updated = await RateLimitEntryModel.findOneAndUpdate(
    { key },
    [
      {
        $set: {
          count: {
            $cond: [{ $gt: ['$resetAt', now] }, { $add: ['$count', 1] }, 1],
          },
          resetAt: {
            $cond: [{ $gt: ['$resetAt', now] }, '$resetAt', newResetAt],
          },
        },
      },
    ],
    { upsert: true, returnDocument: 'after', updatePipeline: true }
  );

  if (updated.count > maxAttempts) {
    const retryAfterSeconds = Math.ceil((updated.resetAt.getTime() - now.getTime()) / 1000);
    return { blocked: true, retryAfterSeconds };
  }
  return { blocked: false, retryAfterSeconds: 0 };
}

export async function clearRateLimitKey(key: string): Promise<void> {
  await RateLimitEntryModel.deleteOne({ key });
}

export async function resetAllRateLimits(keyPrefix?: string): Promise<void> {
  await RateLimitEntryModel.deleteMany(keyPrefix ? { key: { $regex: `^${keyPrefix}` } } : {});
}
