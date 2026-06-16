import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { optionalAuth, validate } from '../../core/middleware';
import { AnalyticsEventBatchSchema } from '../../core/utils/schemas';
import { ingestEvents } from './events.controller';

const router = Router();

// IP-level cap on the public events endpoint — prevents table flooding.
// 20 batches/min is generous for real frontends (each batch holds up to 50 events).
const eventsLimiter = rateLimit({
  windowMs: 60_000,
  max:      20,
  message:  { error: 'Event ingestion rate limit exceeded. Please slow down.' },
});

// Public — works for both logged-in and anonymous users.
// Anonymous events are correlated via client-generated session_id.
router.post('/', eventsLimiter, optionalAuth, validate(AnalyticsEventBatchSchema), ingestEvents);

export default router;
