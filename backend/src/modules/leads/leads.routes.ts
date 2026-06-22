import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../../core/middleware';
import { LeadSchema } from '../../core/utils/schemas';
import { createLead } from './leads.controller';

const router = Router();

// dedicated limiter for the public lead-capture form. The app-wide
// limiter (200/min, see app.ts) is far too generous for an unauthenticated,
// unbounded write endpoint — it allows spam submissions and DB/storage
// abuse well before that ceiling is hit. 5/hour/IP comfortably covers a
// real visitor filling out the "Request a demo" form while making
// automated spam runs impractical.
const leadsLimiter = rateLimit({
  windowMs: 60 * 60_000, // 1 hour
  max:      5,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, error: { code: 'rate_limited', message: 'Too many submissions from this address. Please try again later.' } },
});

// Public — B2B "Request a demo" form (no auth required)
router.post('/', leadsLimiter, validate(LeadSchema), createLead);

export default router;
