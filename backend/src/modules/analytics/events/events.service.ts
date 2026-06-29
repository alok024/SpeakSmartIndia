/**
 * Analytics / Event Tracking Service
 *
 * Lightweight first-party event tracking — no external SaaS dependency.
 * Captures product + funnel events (page views, signups, session starts,
 * upgrade clicks, drop-offs) into `analytics_events` (Supabase).
 *
 * Design:
 *  - Writes are buffered in-memory and flushed in batches (size or interval
 *    triggered) to avoid one DB round-trip per click.
 *  - If the buffer flush fails, events are re-queued via BullMQ (if Redis is
 *    configured) so nothing is silently dropped under load.
 *  - Tracking NEVER blocks or fails the request that triggered it — all
 *    calls are fire-and-forget from the controller's perspective.
 */

import { db, AnalyticsEventRow } from '../../../core/database/client';
import { logger } from '../../../infra/logger';
import { getBackgroundQueue } from '../../../infra/queue/queues';

const log = logger.child({ module: 'analytics-events' });

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER_SIZE   = 200;

let buffer: AnalyticsEventRow[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function ensureTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flush().catch(err => log.error('Scheduled flush failed', { error: (err as Error).message }));
  }, FLUSH_INTERVAL_MS);
  // Don't keep the process alive just for this timer
  flushTimer.unref?.();
}

/**
 * Record a product event. Fire-and-forget — never throws.
 */
export function trackEvent(input: {
  event:       string;
  userId?:     string | null;
  sessionId?:  string | null;
  path?:       string | null;
  plan?:       string | null;
  properties?: Record<string, unknown> | null;
}): void {
  try {
    buffer.push({
      event:      input.event,
      user_id:    input.userId    ?? null,
      session_id: input.sessionId ?? null,
      path:       input.path      ?? null,
      plan:       input.plan      ?? null,
      properties: input.properties ?? null,
      created_at: new Date().toISOString(),
    });

    ensureTimer();

    if (buffer.length >= MAX_BUFFER_SIZE) {
      flush().catch(err => log.error('Size-triggered flush failed', { error: (err as Error).message }));
    }
  } catch (err) {
    // Tracking must never throw into request handlers
    log.error('trackEvent failed', { error: (err as Error).message, event: input.event });
  }
}

/**
 * Flush the current buffer to the database.
 * On failure, falls back to a queued retry (if Redis configured) so
 * events aren't lost during a transient DB blip.
 */
export async function flush(): Promise<void> {
  if (!buffer.length) return;

  const batch = buffer;
  buffer = [];

  try {
    await db.createAnalyticsEvents(batch);
    log.debug('Flushed analytics events', { count: batch.length });
  } catch (err) {
    log.error('Failed to flush analytics events — attempting queued retry', {
      count: batch.length,
      error: (err as Error).message,
    });

    const q = getBackgroundQueue();
    if (q) {
      try {
        await q.add('persist-analytics-events', { events: batch });
        return;
      } catch (qErr) {
        log.error('Failed to queue analytics retry — events dropped', {
          count: batch.length,
          error: (qErr as Error).message,
        });
        return;
      }
    }

    // No queue available — best effort, drop after logging so we don't
    // grow the buffer unboundedly.
  }
}

/**
 * Flush on process shutdown so nothing in the buffer is lost.
 */
export function registerShutdownFlush(): void {
  const handler = () => {
    flush().catch(() => {/* best effort */});
  };
  process.on('beforeExit', handler);
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

// Funnel / reporting queries (used by admin endpoints)

export interface FunnelSummary {
  since:  string;
  events: Array<{ event: string; count: number }>;
}

/**
 * Aggregate event counts since `sinceIso`. Pass `eventNames` to restrict
 * to a specific funnel (e.g. ['page_view','signup','onboarding_complete',
 * 'session_start','session_complete','upgrade_click','upgrade_success']).
 */
export async function getFunnelSummary(sinceIso: string, eventNames?: string[]): Promise<FunnelSummary> {
  const events = await db.getEventCounts(sinceIso, eventNames);
  // Sort by count desc for readability
  events.sort((a, b) => b.count - a.count);
  return { since: sinceIso, events };
}

export async function getRecentEvents(limit = 100, eventName?: string, userId?: string): Promise<AnalyticsEventRow[]> {
  return db.getRecentEvents(limit, eventName, userId);
}

// Common funnel stages — useful default for the dashboard.
export const STANDARD_FUNNEL_EVENTS = [
  'page_view',
  'signup_started',
  'signup',
  'onboarding_complete',
  'session_start',
  'session_complete',
  'upgrade_click',
  'upgrade_success',
  'churn',
] as const;
