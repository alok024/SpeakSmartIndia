/**
 * Per-User Burst Rate Limiter
 *
 * Problem: a user can hit the daily limit check and fire 30 requests
 *          instantaneously, hammering Groq before the usage row updates.
 *
 * The existing express-rate-limit in ai.routes.ts is IP-based (20/min).
 * This adds a tighter, user-identity-based sliding window on top.
 *
 * Default: 3 requests per 10 seconds per user.
 *
 * Config (env vars):
 *   AI_BURST_LIMIT        — max requests per window (default 3)
 *   AI_BURST_WINDOW_MS    — window size in milliseconds (default 10000)
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

const log    = logger.child({ module: 'burst-limiter' });
const LIMIT  = parseInt(process.env.AI_BURST_LIMIT     ?? '3',     10);
const WINDOW = parseInt(process.env.AI_BURST_WINDOW_MS ?? '10000', 10);

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
export async function checkBurstLimit(userId: string): Promise<BurstCheckResult> {
  const redis = getRedis();

  if (!redis) {
    // No Redis — burst limiting not active in this environment
    return { allowed: true, remaining: LIMIT, resetInMs: 0 };
  }

  const now    = Date.now();
  const cutoff = now - WINDOW;
  const key    = KEY(userId);

  try {
    const pipeline = redis.multi();
    pipeline.zremrangebyscore(key, '-inf', cutoff);         // remove old entries
    pipeline.zadd(key, now, `${now}-${Math.random()}`);    // add this request
    pipeline.zcard(key);                                   // count in window
    pipeline.pexpire(key, WINDOW);                         // auto-expire the key

    const results = await pipeline.exec();
    // results[2] is [error, count]
    const count = (results?.[2]?.[1] as number) ?? 0;

    if (count > LIMIT) {
      // Find earliest entry to compute reset time
      const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const oldestTs = oldest.length >= 2 ? parseInt(oldest[1], 10) : now;
      const resetInMs = Math.max(0, oldestTs + WINDOW - now);

      log.info('Burst limit exceeded', { userId, count, limit: LIMIT, resetInMs });
      return { allowed: false, remaining: 0, resetInMs };
    }

    return { allowed: true, remaining: Math.max(0, LIMIT - count), resetInMs: 0 };
  } catch (err) {
    log.warn('Burst limiter Redis error — allowing request (fail-open)', {
      userId,
      error: (err as Error).message,
    });
    return { allowed: true, remaining: LIMIT, resetInMs: 0 };
  }
}
