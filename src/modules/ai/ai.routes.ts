/**
 * AI Routes — Phase 8
 *
 * Request pipeline (in order):
 *   authMiddleware     → JWT validation + blacklist check
 *   aiRateLimit        → IP-based: 20 req/min  (express-rate-limit)
 *   checkUsageLimit    → daily plan quota check  (DB)
 *   handleAI:
 *     └─ checkBurstLimit   → per-user: 3 req/10 s (Redis sliding window)
 *     └─ callAI:
 *          └─ getCachedAIResponse  → Redis cache (free users only)
 *          └─ withAISlot           → concurrency semaphore (max 10 parallel)
 *          └─ groqBreaker.run      → circuit breaker → Groq
 *          └─ openaiBreaker.run    → circuit breaker → OpenAI fallback
 */

import { Router }    from 'express';
import rateLimit     from 'express-rate-limit';
import { authMiddleware, checkUsageLimit } from '../../core/middleware';
import { handleAI }  from './ai.controller';

const router = Router();

// IP-based rate limit — coarse outer guard (unchanged from Phase 7)
const aiRateLimit = rateLimit({
  windowMs: 60_000,
  max:      20,
  message:  { error: 'Too many AI requests. Please wait a minute.' },
});

// POST /api/ai
router.post('/',
  authMiddleware,
  aiRateLimit,
  checkUsageLimit,
  handleAI
);

export default router;
