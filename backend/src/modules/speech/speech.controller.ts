/**
 * modules/speech/speech.controller.ts
 *
 * Handlers for:
 *   POST /api/speech-metrics  — save per-session filler/WPM data
 *   GET  /api/speech-metrics  — return trend rows for the current user
 */

import { Request, Response } from 'express';
import { asyncHandler }      from '../../core/middleware';
import { ok }                from '../../core/utils/response';
import { saveSpeechMetrics, getSpeechTrend } from './speech.service';
import type { SaveSpeechMetricsDTO }         from './speech.schemas';

/**
 * POST /api/speech-metrics
 *
 * Body is pre-validated by validate(SaveSpeechMetricsSchema) in the route.
 * The save is intentionally non-blocking from the client's perspective
 * (fire-and-forget in session/page.tsx) but the server still returns a
 * meaningful status so devtools / Sentry catches silent failures.
 *
 * Returns 200 on success and on idempotent re-submission (duplicate
 * client_session_id). Returns 502 only on a genuine DB write error.
 */
export const handleSaveSpeechMetrics = asyncHandler(async (req: Request, res: Response) => {
  const dto = req.body as SaveSpeechMetricsDTO;

  await saveSpeechMetrics({
    userId:            req.user!.id,
    client_session_id: dto.client_session_id,
    filler_count:      dto.filler_count,
    wpm:               dto.wpm,
    answer_count:      dto.answer_count,
  });

  ok(res, { saved: true });
});

/**
 * GET /api/speech-metrics
 *
 * Returns up to 20 data points (oldest-first) for the current user.
 * The dashboard card enforces the "3+ sessions with metrics" gate on
 * the frontend so it can show a meaningful trend line.
 *
 * Returns { trend: [] } when the user has no data yet — never 404.
 */
export const handleGetSpeechTrend = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(
    parseInt(String(req.query.limit ?? '20'), 10) || 20,
    50,
  );

  const trend = await getSpeechTrend(req.user!.id, limit);
  ok(res, { trend });
});
