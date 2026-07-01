/**
 * Circuit breaker for Groq Whisper STT.
 *
 * In-process (no Redis) — STT is a fast, synchronous request with clear
 * success/failure signal. After THRESHOLD consecutive failures the breaker
 * opens and callers fall straight through to the Sarvam Saarika fallback,
 * avoiding the full Groq timeout on every user turn during an outage.
 *
 * Recovery: after COOLDOWN_MS the breaker half-opens and probes with the
 * next real STT request; success closes it immediately.
 */

import { logger } from './logger';

const log = logger.child({ module: 'groq-stt-breaker' });

const THRESHOLD   = 3;
const COOLDOWN_MS = 20_000;

type State = 'closed' | 'open' | 'half_open';

let state:       State  = 'closed';
let failures:    number = 0;
let openedAt:    number = 0;
let probeActive: boolean = false;

/** True when the breaker will allow a Groq STT attempt. */
export function sttBreakerAvailable(): boolean {
  if (state === 'closed') return true;

  if (state === 'open') {
    if (Date.now() - openedAt >= COOLDOWN_MS) {
      state       = 'half_open';
      probeActive = false;
      log.info('groq-stt-breaker: OPEN → HALF_OPEN');
    } else {
      return false;
    }
  }

  // HALF_OPEN — one probe at a time
  if (probeActive) return false;
  probeActive = true;
  return true;
}

export function sttBreakerSuccess(): void {
  if (state !== 'closed') {
    log.info('groq-stt-breaker: recovered → CLOSED');
  }
  state       = 'closed';
  failures    = 0;
  probeActive = false;
}

export function sttBreakerFailure(): void {
  probeActive = false;
  failures++;
  if (failures >= THRESHOLD) {
    state    = 'open';
    openedAt = Date.now();
    log.warn('groq-stt-breaker: OPENED', { failures, threshold: THRESHOLD });
    failures = 0;
  }
}
