/**
 * Per-User Burst Rate Limiter — plan-aware
 *
 * Problem: a user can hit the daily limit check and fire 30 requests
 *          instantaneously, hammering Groq before the usage row updates.
 *
 * The existing express-rate-limit in ai.routes.ts is IP-based (20/min).
 * This adds a tighter, user-identity-based sliding window on top.
 *
 * Limits by plan:
 *   free:    2 req / 15 s  — tightest; these users are at highest abuse risk
 *   pro:     5 req / 10 s
 *   elite:  10 req / 10 s  — widest; paying subscribers get real headroom
 *   default: 3 req / 10 s  — fallback when plan is unknown
 *
 * Implementation:
 *   Redis sorted set per user.  Each request adds the current timestamp
 *   as both score and member.  We remove all members older than the
 *   window, then count.  Uses a single MULTI/EXEC transaction — safe
 *   under concurrent requests.
 *
 *   Falls back gracefully (allows request) when Redis is unavailable.
 */

import { getRedis } from './queue/redis';
import { logger }   from './logger';

const log = logger.child({ module: 'burst-limiter' });

// ── Plan-aware config ─────────────────────────────────────────────

interface BurstConfig { limit: number; windowMs: number; }

const PLAN_BURST: Record<string, BurstConfig> = {
  free:    { limit: 2,  windowMs: 15_000 },
  pro:     { limit: 5,  windowMs: 10_000 },
  elite:   { limit: 10, windowMs: 10_000 },
  default: { limit: 3,  windowMs: 10_000 },
};

const KEY = (userId: string) => `ai:burst:${userId}`;

export interface BurstCheckResult {
  allowed:   boolean;
  remaining: number;
  resetInMs: number;
}

/**
 * Returns { allowed: true } if the user is under their burst limit.
 * Returns { allowed: false } with retry info when they're over it.
 *
 * On Redis failure, allows the request (fail-open) so a Redis outage
 * doesn't lock every user out of the product.
 */
export async function checkBurstLimit(
  userId: string,
  plan   = 'default',
): Promise<BurstCheckResult> {
  const redis = getRedis();

  const { limit, windowMs } = PLAN_BURST[plan] ?? PLAN_BURST.default;

  if (!redis) {
    // No Redis — burst limiting not active in this environment
    return { allowed: true, remaining: limit, resetInMs: 0 };
  }

  const now    = Date.now();
  const cutoff = now - windowMs;
  const key    = KEY(userId);

  try {
    const pipeline = redis.multi();
    pipeline.zremrangebyscore(key, '-inf', cutoff);         // remove old entries
    pipeline.zadd(key, now, `${now}-${Math.random()}`);    // add this request
    pipeline.zcard(key);                                   // count in window
    pipeline.pexpire(key, windowMs);                       // auto-expire the key

    const results = await pipeline.exec();
    // results[2] is [error, count]
    const count = (results?.[2]?.[1] as number) ?? 0;

    if (count > limit) {
      // Find earliest entry to compute reset time
      const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const oldestTs = oldest.length >= 2 ? parseInt(oldest[1], 10) : now;
      const resetInMs = Math.max(0, oldestTs + windowMs - now);

      log.info('Burst limit exceeded', { userId, plan, count, limit, resetInMs });
      return { allowed: false, remaining: 0, resetInMs };
    }

    return { allowed: true, remaining: Math.max(0, limit - count), resetInMs: 0 };
  } catch (err) {
    log.warn('Burst limiter Redis error — allowing request (fail-open)', {
      userId,
      error: (err as Error).message,
    });
    return { allowed: true, remaining: limit, resetInMs: 0 };
  }
}
