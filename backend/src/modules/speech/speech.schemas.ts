/**
 * modules/speech/speech.schemas.ts
 *
 * Zod request body schemas for the speech-metrics endpoints.
 */

import { z } from 'zod';

// POST /api/speech-metrics
//
// client_session_id is the idempotency key — same UUID stored in the
// sessions table. The backend uses it to do an INSERT … ON CONFLICT DO NOTHING
// so a client retry (e.g. a dropped fire-and-forget fetch that retried
// on the next page load) never produces a duplicate row.
//
// filler_count: total fillers detected across all answers.
// wpm:          estimated words-per-minute for the session (0 if not computable).
// answer_count: number of answers analysed (so the dashboard knows whether
//               to trust the numbers — e.g. a 1-question session has less
//               statistical weight than a 10-question one).
export const SaveSpeechMetricsSchema = z.object({
  client_session_id: z.string().uuid('client_session_id must be a UUID'),
  filler_count:      z.number().int().min(0).max(10_000),
  wpm:               z.number().int().min(0).max(32_767),
  answer_count:      z.number().int().min(0).max(100),
});

export type SaveSpeechMetricsDTO = z.infer<typeof SaveSpeechMetricsSchema>;
