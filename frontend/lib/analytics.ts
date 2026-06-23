/**
 * lib/analytics.ts
 *
 * Lightweight first-party event tracking.
 * Fire-and-forget — never throws, never blocks the caller.
 *
 * Usage:
 *   import { track } from '@/lib/analytics';
 *   track('session_started', { profession: 'Software Developer', mode: 'chat' });
 *
 * Events are batched in a micro-queue and flushed on the next tick so
 * multiple track() calls in the same synchronous block cost one fetch.
 *
 * The backend endpoint is /api/events (POST), which accepts:
 *   { events: [{ event, session_id?, path?, properties? }] }
 * See: backend/src/core/utils/schemas.ts → AnalyticsEventBatchSchema
 */

import { BACKEND_URL } from '@/lib/api';

interface TrackPayload {
  event:       string;
  session_id?: string;
  path?:       string;
  properties?: Record<string, string | number | boolean | null>;
}

// Micro-queue — accumulates events within a single JS tick, then flushes once.
let queue: TrackPayload[] = [];
let flushScheduled = false;

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;

  // queueMicrotask runs before the next I/O event but after the current
  // synchronous call stack — batches multiple track() calls in one render
  // into a single fetch without introducing any artificial delay.
  queueMicrotask(async () => {
    flushScheduled = false;
    if (queue.length === 0) return;

    const batch = queue.splice(0, 50); // backend max is 50 per batch

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      await fetch(`${BACKEND_URL}/api/events`, {
        method:       'POST',
        headers,
        credentials:  'include',
        body:        JSON.stringify({ events: batch }),
        // keepalive lets the request survive page unload (session_abandoned
        // fires as the user navigates away). Browsers cap keepalive at 64 KB
        // so we keep batches small — 50 events is well within that.
        keepalive:   true,
      });
    } catch {
      // Silently swallow — tracking must never break the product.
    }
  });
}

/**
 * Fire a product analytics event.
 * Safe to call anywhere — server components, hooks, event handlers.
 * Does nothing during SSR (no `fetch` side-effects on the server).
 */
export function track(
  event:       string,
  properties?: Record<string, string | number | boolean | null>,
  options?:    { session_id?: string; path?: string },
): void {
  // Guard: skip during SSR
  if (typeof window === 'undefined') return;

  const payload: TrackPayload = {
    event,
    path:       options?.path ?? window.location.pathname,
    session_id: options?.session_id,
    properties,
  };

  queue.push(payload);
  scheduleFlush();
}

// ─── Named event helpers ────────────────────────────────────────────────────
// Keeps call sites terse and event names consistent across the codebase.

export const analytics = {
  sessionStarted(opts: {
    session_id:     string;
    profession:     string;
    mode:           string;
    difficulty:     string;
    interview_type: string;
  }) {
    track('session_started', {
      profession:     opts.profession,
      mode:           opts.mode,
      difficulty:     opts.difficulty,
      interview_type: opts.interview_type,
    }, { session_id: opts.session_id });
  },

  sessionCompleted(opts: {
    session_id: string;
    score:      number;
    exchanges:  number;
    duration_secs: number;
    profession: string;
    mode:       string;
  }) {
    track('session_completed', {
      score:         opts.score,
      exchanges:     opts.exchanges,
      duration_secs: opts.duration_secs,
      profession:    opts.profession,
      mode:          opts.mode,
    }, { session_id: opts.session_id });
  },

  sessionAbandoned(opts: {
    session_id:     string;
    profession:     string;
    mode:           string;
    questions_seen: number;
  }) {
    track('session_abandoned', {
      profession:     opts.profession,
      mode:           opts.mode,
      questions_seen: opts.questions_seen,
    }, { session_id: opts.session_id });
  },

  upgradeModalOpened(opts: {
    trigger: string | null;
    plan?:   string | null;
  }) {
    track('upgrade_modal_opened', {
      trigger: opts.trigger ?? 'unknown',
      plan:    opts.plan ?? null,
    });
  },

  day7Active(opts: { days_since_signup: number }) {
    track('day7_active', { days_since_signup: opts.days_since_signup });
  },

  jobLandedSubmitted(opts: { show_on_board: boolean; has_company: boolean }) {
    track('job_landed_submitted', {
      show_on_board: opts.show_on_board,
      has_company:   opts.has_company,
    });
  },
};
