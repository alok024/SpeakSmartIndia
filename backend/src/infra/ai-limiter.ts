/**
 * AI Concurrency Limiter
 *
 * Problem: 100 concurrent users → 100 simultaneous Groq API calls
 *          → rate-limit errors, connection exhaustion, latency spikes.
 *
 * Solution: an in-process semaphore that caps parallel AI calls.
 *           Callers AWAIT the limiter — they block internally until a
 *           slot is free, then proceed.  From the user's perspective
 *           the response is still synchronous; we never return a jobId.
 *
 * Config:
 *   MAX_CONCURRENT_AI_CALLS  — max parallel Groq/OpenAI calls (default 10)
 *   AI_QUEUE_TIMEOUT_MS      — how long a queued request may wait before
 *                              we give up with a 503 (default 30 s)
 *
 * Usage:
 *   import { withAISlot } from '../../infra/ai-limiter';
 *   const result = await withAISlot(() => callAI(messages));
 */

import { logger } from './logger';
import { env }    from '../core/config/env';

const log = logger.child({ module: 'ai-limiter' });

// ── Config ────────────────────────────────────────────────────────

const MAX_CONCURRENT = env.MAX_CONCURRENT_AI_CALLS;
const QUEUE_TIMEOUT  = env.AI_QUEUE_TIMEOUT_MS;

// ── Semaphore state ───────────────────────────────────────────────

let active  = 0;
const waiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Remove ourselves from the queue so we don't unblock a future slot
      const idx = waiters.findIndex(w => w.resolve === resolve);
      if (idx !== -1) waiters.splice(idx, 1);

      log.warn('AI queue timeout — request dropped', {
        active,
        queued: waiters.length,
        timeoutMs: QUEUE_TIMEOUT,
      });

      reject(Object.assign(
        new Error('AI service is busy right now. Please try again in a moment.'),
        { statusCode: 503, code: 'AI_QUEUE_TIMEOUT' }
      ));
    }, QUEUE_TIMEOUT);

    waiters.push({
      resolve: () => { clearTimeout(timer); resolve(); },
      reject,
    });
  });
}

function release(): void {
  const next = waiters.shift();
  if (next) {
    // Give the slot straight to the next waiter
    next.resolve();
  } else {
    active--;
  }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Run `fn` once an AI concurrency slot is available.
 * Always awaits — never returns a job ID.
 */
export async function withAISlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  log.debug('AI slot acquired', { active, queued: waiters.length });

  try {
    return await fn();
  } finally {
    release();
    log.debug('AI slot released', { active, queued: waiters.length });
  }
}

/** Diagnostic — useful for health-check endpoints */
export function getAILimiterStats() {
  return { active, queued: waiters.length, maxConcurrent: MAX_CONCURRENT };
}
