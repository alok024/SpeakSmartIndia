/**
 * AI routes — middleware stack per request:
 *   authMiddleware     → JWT validation + blacklist check
 *   requireVerified    → DB-verified email check
 *   requireOnboarded   → onboarding_completed_at gate (DB)
 *   checkUsageLimit    → daily plan quota check  (DB)
 *   validate(...)      → Zod body validation
 *   controller         → handler
 */
import { Router } from 'express';
import * as AIController from './ai.controller';
import {
  authMiddleware,
  requireVerified,
  requireOnboarded,
  checkUsageLimit,
  validate,
} from '../../core/middleware';
import { AIRequestSchema } from '../../core/utils/schemas';

const router = Router();

// BUG FIX: session.js's non-streaming callAI() posts to POST /api/ai (root),
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

// FIX H6: Dedicated endpoint for non-counted helper calls (hints, grammar
// checks, drills). The isFreeCall flag is derived from this path in the
// controller — not from the client body — so clients cannot self-grant
// free calls on the counted /practice or /stream endpoints.
// checkUsageLimit is still applied so the middleware sets req.callCount,
// but the controller skips incrementing usage when it sees req.path === '/free'.
router.post(
  '/free',
  authMiddleware,
  requireVerified,
  requireOnboarded,
  checkUsageLimit,
  validate(AIRequestSchema),
  AIController.handleAI,
);

export default router;
