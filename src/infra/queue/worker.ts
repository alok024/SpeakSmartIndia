/**
 * Background Worker
 *
 * Processes every job on `speaksmart:background`.
 * Runs as a separate process in production (see src/worker.ts entry point).
 * Can also run in the same process during development.
 *
 * IMPORTANT — all handlers must be IDEMPOTENT.
 * BullMQ retries failed jobs. A job that partially completes
 * and is retried must not create duplicate data.
 * The underlying services (persistMistakesFromFeedback, recomputeWeakAreas)
 * already use upsert semantics — they are safe to retry.
 *
 * Concurrency = 5:
 *   At most 5 jobs run in parallel per worker process.
 *   Scale by running more worker processes, not by raising this number.
 */

import { Worker, Job } from 'bullmq';
import { getRedis } from './redis';
import { QUEUE_NAME } from './queues';
import { logger } from '../logger';

const log = logger.child({ module: 'worker' });

export function startBackgroundWorker(): Worker | null {
  const conn = getRedis();

  if (!conn) {
    log.warn('Redis not configured — background worker NOT started (jobs run inline)');
    return null;
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      log.debug('Processing job', { name: job.name, id: job.id, attempt: job.attemptsMade + 1 });

      switch (job.name) {

        // ── Persist AI memory mistakes ──────────────────────────────
        case 'persist-mistakes': {
          const { persistMistakesFromFeedback } =
            await import('../../modules/ai/ai.memory');
          await persistMistakesFromFeedback(
            job.data.userId,
            job.data.topic,
            job.data.feedbacks
          );
          break;
        }

        // ── Recompute weak areas ────────────────────────────────────
        case 'recompute-weak-areas': {
          const { recomputeWeakAreas } =
            await import('../../modules/analytics/weak_areas.service');
          await recomputeWeakAreas(job.data.userId);
          break;
        }

        // ── Expire overdue subscriptions (hourly cron) ──────────────
        case 'expire-subscriptions': {
          const { expireOverdueSubscriptions } =
            await import('../../modules/payment/payment.service');
          await expireOverdueSubscriptions();
          break;
        }

        default:
          log.warn('Unknown job name — skipped', { name: job.name, id: job.id });
      }
    },
    {
      connection:  conn,
      concurrency: 5,
    }
  );

  // ── Event listeners ─────────────────────────────────────────────

  worker.on('completed', (job: Job) =>
    log.info('Job completed', {
      name:     job.name,
      id:       job.id,
      attempts: job.attemptsMade,
    })
  );

  worker.on('failed', (job: Job | undefined, err: Error) =>
    log.error('Job failed', {
      name:     job?.name,
      id:       job?.id,
      attempts: job?.attemptsMade,
      error:    err.message,
    })
  );

  worker.on('error', (err: Error) =>
    log.error('Worker-level error', { error: err.message })
  );

  log.info('Background worker started', { queue: QUEUE_NAME, concurrency: 5 });
  return worker;
}
