/**
 * AI routes — middleware stack per request:
 *   authMiddleware     → JWT validation + blacklist check
 *   requireVerified    → DB-verified email check
 *   requireOnboarded   → onboarding_completed_at gate (DB)
 *   checkUsageLimit    → daily plan quota check  (DB)  [skipped on /free]
 *   validate(...)      → Zod body validation
 *   controller         → handler
 */
import { Router } from 'express';
import * as AIController from './chat.controller';
import { handleDailyQuestion } from '../daily-question/daily-question.controller';
import {
  authMiddleware,
  requireVerified,
  requireOnboarded,
  checkUsageLimit,
  validate,
} from '../../../core/middleware';
import { AIRequestSchema } from '../../../core/utils/schemas';

const router = Router();

// session.js's non-streaming callAI() posts to POST /api/ai (root),
// but only /practice, /stream, and /free were registered — every classic-mode
// AI call 404'd. Alias the root path to the same handler/middleware as /practice.
router.post(
  '/',
  authMiddleware,
  requireVerified,
  requireOnboarded,
  checkUsageLimit,
  validate(AIRequestSchema),
  AIController.handleAI,
);

router.post(
  '/practice',
  authMiddleware,
  requireVerified,
  requireOnboarded,
  checkUsageLimit,
  validate(AIRequestSchema),
  AIController.handleAI,
);

// Real-time streaming variant — same gates, but tokens are pushed to the
// client via SSE as the model generates them.
router.post(
  '/stream',
  authMiddleware,
  requireVerified,
  requireOnboarded,
  checkUsageLimit,
  validate(AIRequestSchema),
  AIController.handleAIStream,
);

// /free is for non-counted helper calls (hints, grammar checks, drill tips)
// within an active session — must work even after a free user's quota is
// exhausted, so checkUsageLimit is intentionally omitted. Still fully
// auth-gated. Usage is counted at session-save (sessions.service.ts), not
// per AI call, so this doesn't affect accounting.
router.post(
  '/free',
  authMiddleware,
  requireVerified,
  requireOnboarded,
  validate(AIRequestSchema),
  AIController.handleAI,
);

// GET /api/ai/daily-question — Easy build item, shown on the dashboard.
// Read-only, no usage-quota gate (same exemption as /free): doesn't
// touch a user's AI-call counter, and is the same question for every
// user on a given IST day, so there's nothing to rate-limit per-user.
router.get(
  '/daily-question',
  authMiddleware,
  requireVerified,
  handleDailyQuestion,
);

export default router;
