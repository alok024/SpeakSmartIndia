/**
 * System Load Monitor
 *
 * Complements the per-user burst limiter and concurrency semaphore
 * with system-wide visibility and a load-shedding gate.
 *
 * This module tracks:
 *   1. Requests-per-minute across ALL users (rolling 60-second window)
 *   2. Active AI slots consumed right now
 *   3. Queue depth (waiting for a slot)
 *   4. A load-shedding gate: if RPM exceeds threshold, early-reject
 *      with 503 before even acquiring a slot — protects Groq quota.
 *
 * Load shedding
 *   Config:
 *     SYSTEM_MAX_RPM       — max AI requests/min system-wide (default 60)
 *     SYSTEM_SHED_ENABLED  — set to "false" to disable shedding (default true)
 *
 *   When active:
 *     requestExceedsSystemLoad() returns { overloaded: true }
 *     → controller responds 503 immediately, no slot acquired, no Groq call
 *
 * Metrics endpoint
 *   getSystemLoadStats() is called by GET /health/metrics (see app.ts)
 *   and logged every 5 minutes by the background monitor.
 *
 * Implementation
 *   Sliding window via a ring buffer of timestamps (in-process).
 *   Redis is NOT used here — system load is a per-process concern.
 *   If you scale to multiple processes, use Redis INCR + expiry instead.
 */

import { logger }           from './logger';
import { env }              from '../core/config/env';
import { getAILimiterStats } from './ai-limiter';
import { increment }         from './observability';

const log = logger.child({ module: 'load-monitor' });

const MAX_RPM      = env.SYSTEM_MAX_RPM;
const SHED_ENABLED = env.SYSTEM_SHED_ENABLED;   // boolean — coerced by Zod in env.ts
const WINDOW_MS    = 60_000;

// Sliding window ring buffer

const _timestamps: number[] = [];

function recordRequest(): void {
  const now    = Date.now();
  const cutoff = now - WINDOW_MS;

  // Prune old entries — keep ring buffer small
  while (_timestamps.length > 0 && _timestamps[0] < cutoff) {
    _timestamps.shift();
  }
  _timestamps.push(now);
}

function currentRPM(): number {
  const cutoff = Date.now() - WINDOW_MS;
  // Count entries in the last 60 s
  let count = 0;
  for (let i = _timestamps.length - 1; i >= 0; i--) {
    if (_timestamps[i] < cutoff) break;
    count++;
  }
  return count;
}

// Public API

export interface LoadCheckResult {
  overloaded: boolean;
  rpm:        number;
  maxRpm:     number;
}

/**
 * Call BEFORE acquiring an AI slot.
 * Records the request attempt and checks whether we're over the RPM cap.
 */
export function checkSystemLoad(): LoadCheckResult {
  recordRequest();
  const rpm = currentRPM();

  if (SHED_ENABLED && rpm > MAX_RPM) {
    increment('ai.system.overload');
    log.warn('System load shedding triggered', { rpm, maxRpm: MAX_RPM });
    return { overloaded: true, rpm, maxRpm: MAX_RPM };
  }

  return { overloaded: false, rpm, maxRpm: MAX_RPM };
}

export interface SystemLoadStats {
  rpm:            number;
  max_rpm:        number;
  load_pct:       number;
  shed_enabled:   boolean;
  ai_slots:       ReturnType<typeof getAILimiterStats>;
  window_size_s:  number;
}

export function getSystemLoadStats(): SystemLoadStats {
  const rpm = currentRPM();
  return {
    rpm,
    max_rpm:       MAX_RPM,
    load_pct:      Math.round((rpm / MAX_RPM) * 100),
    shed_enabled:  SHED_ENABLED,
    ai_slots:      getAILimiterStats(),
    window_size_s: WINDOW_MS / 1000,
  };
}

// Background logger (every 5 min)
// Called once at startup from app.ts — gives ops a heartbeat in logs.

export function startLoadMonitor(): void {
  setInterval(() => {
    const stats = getSystemLoadStats();
    if (stats.rpm > 0 || stats.ai_slots.active > 0) {
      log.info('System load snapshot', stats);
    }
  }, 5 * 60 * 1_000);
}
