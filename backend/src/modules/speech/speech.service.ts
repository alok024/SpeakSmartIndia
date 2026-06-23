/**
 * modules/speech/speech.service.ts
 *
 * Saves a speech-metrics row for a completed session, and retrieves
 * the per-user trend data used by the dashboard "Speech Trends" card.
 *
 * Both operations are implemented against the speech_metrics table
 * defined in migrations/016_speech_metrics.sql.
 */

import { db }      from '../../core/database/client';
import { env }     from '../../core/config/env';
import { AppError } from '../../core/utils/errors';
import { logger }  from '../../infra/logger';

const log = logger.child({ module: 'speech' });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpeechMetricsRow {
  id:                string;
  user_id:           string;
  session_id:        string;
  client_session_id: string;
  filler_count:      number;
  wpm:               number;
  answer_count:      number;
  created_at:        string;
}

export interface SaveSpeechMetricsInput {
  userId:            string;
  client_session_id: string;
  filler_count:      number;
  wpm:               number;
  answer_count:      number;
}

export interface SpeechTrendPoint {
  created_at:   string;
  filler_count: number;
  wpm:          number;
  answer_count: number;
}

// ─── Save ─────────────────────────────────────────────────────────────────────

/**
 * Persist speech metrics for one completed session.
 *
 * Resolution strategy: ignore-duplicates (ON CONFLICT DO NOTHING on
 * client_session_id). If the client retries a dropped fire-and-forget
 * POST, the second write is a harmless no-op — the original row stands.
 *
 * The session_id (server-assigned UUID) is looked up from the sessions
 * table by client_session_id so the foreign key constraint is satisfied
 * without the client needing to know the server-assigned ID.
 */
export async function saveSpeechMetrics(input: SaveSpeechMetricsInput): Promise<void> {
  const { userId, client_session_id, filler_count, wpm, answer_count } = input;

  // Resolve the server-assigned session UUID from the idempotency key.
  // The session must already exist (saved by POST /api/sessions) before
  // the fire-and-forget POST /api/speech-metrics fires — both come from
  // finishSession() in session/page.tsx, with the speech POST sent after
  // the session save awaits, so timing is safe in the common case.
  // On network delays the session row might not be there yet; we treat
  // that as a non-fatal miss (log + return) rather than a 502.
  const sessionRows = await fetch(
    `${env.SUPABASE_URL}/rest/v1/sessions?client_session_id=eq.${encodeURIComponent(client_session_id)}&user_id=eq.${encodeURIComponent(userId)}&select=id`,
    {
      headers: {
        'Content-Type':  'application/json',
        apikey:          env.SUPABASE_SERVICE_KEY,
        Authorization:   `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  ).then(r => r.json()) as { id: string }[];

  const sessionId = sessionRows?.[0]?.id;

  if (!sessionId) {
    // Session row not found — either the session save failed or raced ahead
    // of this call. Log and bail; the metric is simply not recorded for
    // this session. The dashboard "3+ sessions" guard handles sparse data.
    log.warn('saveSpeechMetrics: session not found for client_session_id — skipping', {
      userId, client_session_id,
    });
    return;
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/speech_metrics`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      apikey:          env.SUPABASE_SERVICE_KEY,
      Authorization:   `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      // ON CONFLICT (client_session_id) DO NOTHING — idempotent retries
      Prefer:          'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify({
      user_id:           userId,
      session_id:        sessionId,
      client_session_id,
      filler_count,
      wpm,
      answer_count,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AppError(502, 'speech_metrics_write_failed', `speech_metrics insert failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }

  log.info('saveSpeechMetrics: saved', {
    userId, client_session_id, filler_count, wpm, answer_count,
  });
}

// ─── Trend data ───────────────────────────────────────────────────────────────

/**
 * Return the most recent `limit` speech-metrics rows for a user,
 * oldest-first so the dashboard chart renders left-to-right in time order.
 *
 * Returns an empty array when the user has no rows yet (first-time caller).
 */
export async function getSpeechTrend(
  userId: string,
  limit = 20,
): Promise<SpeechTrendPoint[]> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/speech_metrics` +
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=created_at,filler_count,wpm,answer_count` +
    `&order=created_at.desc` +
    `&limit=${limit}`,
    {
      headers: {
        'Content-Type':  'application/json',
        apikey:          env.SUPABASE_SERVICE_KEY,
        Authorization:   `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );

  if (!res.ok) {
    log.warn('getSpeechTrend: query failed', { userId, status: res.status });
    return [];
  }

  const rows = await res.json() as SpeechTrendPoint[];
  // Reverse so the array is oldest-first for charting
  return (rows ?? []).reverse();
}
