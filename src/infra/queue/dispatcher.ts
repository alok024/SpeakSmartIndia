/**
 * Queue Dispatcher
 *
 * The ONLY file the rest of the app imports to enqueue work.
 * sessions.service.ts and app.ts call this — never BullMQ directly.
 *
 * Degradation contract:
 *   REDIS_URL set   → job goes to BullMQ queue (retry, backoff, worker)
 *   REDIS_URL unset → job runs inline, fire-and-forget (current dev behaviour)
 *
 * This means your local dev works exactly as before with zero Redis setup.
 */

import { getBackgroundQueue } from './queues';
import { logger } from '../logger';
import type { FeedbackItem } from '../../modules/ai/ai.memory';

const log = logger.child({ module: 'dispatcher' });

// ── Enqueue: persist mistakes from a completed session ────────────

export async function dispatchPersistMistakes(
  userId:    string,
  topic:     string,
  feedbacks: FeedbackItem[]
): Promise<void> {
  const q = getBackgroundQueue();

  if (!q) {
    // No Redis — run inline (dev / degraded mode)
    const { persistMistakesFromFeedback } =
      await import('../../modules/ai/ai.memory');
    persistMistakesFromFeedback(userId, topic, feedbacks).catch(() => {/* logged inside */});
    return;
  }

  try {
    await q.add('persist-mistakes', { userId, topic, feedbacks });
    log.debug('Queued persist-mistakes', { userId });
  } catch (err) {
    // Queue failure must never break the session save response
    log.error('Failed to queue persist-mistakes — running inline', { userId, error: err });
    const { persistMistakesFromFeedback } =
      await import('../../modules/ai/ai.memory');
    persistMistakesFromFeedback(userId, topic, feedbacks).catch(() => {});
  }
}

// ── Enqueue: recompute weak areas after a session ─────────────────

export async function dispatchRecomputeWeakAreas(userId: string): Promise<void> {
  const q = getBackgroundQueue();

  if (!q) {
    const { recomputeWeakAreas } =
      await import('../../modules/analytics/weak_areas.service');
    recomputeWeakAreas(userId).catch(() => {/* logged inside */});
    return;
  }

  try {
    // 2 second delay — let the session DB write settle first
    await q.add('recompute-weak-areas', { userId }, { delay: 2_000 });
    log.debug('Queued recompute-weak-areas', { userId });
  } catch (err) {
    log.error('Failed to queue recompute-weak-areas — running inline', { userId, error: err });
    const { recomputeWeakAreas } =
      await import('../../modules/analytics/weak_areas.service');
    recomputeWeakAreas(userId).catch(() => {});
  }
}

// ── Schedule: subscription expiry — called ONCE on app startup ────
//
// With Redis:    registers a BullMQ repeatable job (every 1 hour).
//               The stable jobId prevents duplicate registrations
//               across restarts — BullMQ is idempotent on jobId.
// Without Redis: falls back to plain setInterval (current behaviour).

export async function scheduleSubscriptionExpiry(): Promise<void> {
  const q = getBackgroundQueue();

  if (!q) {
    const { expireOverdueSubscriptions } =
      await import('../../modules/payment/payment.service');

    expireOverdueSubscriptions().catch(err =>
      log.error('Subscription expiry failed on startup', { error: err })
    );
    setInterval(() =>
      expireOverdueSubscriptions().catch(err =>
        log.error('Subscription expiry failed (interval)', { error: err })
      ),
      60 * 60 * 1_000
    );
    log.info('Subscription expiry scheduled (setInterval — no Redis)');
    return;
  }

  try {
    await q.add(
      'expire-subscriptions',
      { triggeredAt: new Date().toISOString() },
      {
        jobId:  'expire-subscriptions-hourly', // stable — prevents duplicates on restart
        repeat: { every: 60 * 60 * 1_000 },
      }
    );
    log.info('Subscription expiry scheduled (BullMQ, every 1h)');
  } catch (err) {
    log.error('Failed to schedule subscription expiry via BullMQ', { error: err });
  }
}
