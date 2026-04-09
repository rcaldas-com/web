import redis from '@/lib/redis';

type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfter: number };

/**
 * Rate limiter using Redis INCR + EXPIRE.
 * @param key - Unique key (e.g. "login:192.168.1.1")
 * @param maxAttempts - Max allowed attempts within the window
 * @param windowSeconds - Time window in seconds
 */
export async function rateLimit(
  key: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`;
  const current = await redis.incr(redisKey);

  if (current === 1) {
    await redis.expire(redisKey, windowSeconds);
  }

  if (current > maxAttempts) {
    const ttl = await redis.ttl(redisKey);
    return { ok: false, retryAfter: ttl > 0 ? ttl : windowSeconds };
  }

  return { ok: true };
}
