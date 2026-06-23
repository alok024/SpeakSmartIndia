/**
 * modules/interview/interview.routes.ts
 *
 * Mounted at /api/interview in app.ts.
 *
 * Middleware chain mirrors the AI routes exactly:
 *   authMiddleware    → JWT validation + blacklist check
 *   requireVerified   → DB-verified email
 *   requireOnboarded  → onboarding gate
 *   checkUsageLimit   → plan quota (same counter as /api/ai calls — this
 *                       generates questions, which counts as an AI use)
 *   validate(...)     → Zod body validation
 *   controller        → handler
 */

import { Router } from 'express';
import {
  authMiddleware,
  requireVerified,
  requireOnboarded,
  checkUsageLimit,
  validate,
} from '../../core/middleware';
import { JdQuestionsSchema } from './interview.schemas';
import { handleJdQuestions }  from './interview.controller';

const router = Router();

// POST /api/interview/jd-questions
// Counts against the user's AI call quota (same as /api/ai) — generating
// JD-specific questions is an AI use, not a free utility call.
router.post(
  '/jd-questions',
  authMiddleware,
  requireVerified,
  requireOnboarded,
  checkUsageLimit,
  validate(JdQuestionsSchema),
  handleJdQuestions,
);

export default router;
