/**
 * modules/speech/speech.routes.ts
 *
 * Mounted at /api/speech-metrics in app.ts.
 *
 * Auth chain mirrors the sessions routes:
 *   authMiddleware   → JWT validation + blacklist check
 *   requireVerified  → email must be verified
 *   requireOnboarded → onboarding must be complete
 *
 * No plan gate on POST: all users benefit from speech feedback (it's a
 * lightweight metric, not a paywalled AI call).
 * No plan gate on GET: all users can see their own trend data.
 * The dashboard card itself only renders after 3+ data points, which
 * naturally creates a "you have to use it to see it" engagement loop.
 */

import { Router } from 'express';
import {
  authMiddleware,
  requireVerified,
  requireOnboarded,
  validate,
} from '../../core/middleware';
import { SaveSpeechMetricsSchema } from './speech.schemas';
import {
  handleSaveSpeechMetrics,
  handleGetSpeechTrend,
} from './speech.controller';

const router = Router();

// POST /api/speech-metrics — save one session's metrics (fire-and-forget safe)
router.post(
  '/',
  authMiddleware,
  requireVerified,
  requireOnboarded,
  validate(SaveSpeechMetricsSchema),
  handleSaveSpeechMetrics,
);

// GET /api/speech-metrics — trend data for the dashboard chart
router.get(
  '/',
  authMiddleware,
  requireVerified,
  handleGetSpeechTrend,
);

export default router;
