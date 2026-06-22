import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getShareToken, getReport } from './reports.controller';

const router = Router();

// defense-in-depth — even with HMAC-signed tokens, rate-limit the
// public report endpoint to slow down enumeration/brute-force attempts
// against it (and generic scraping of public report pages).
const reportLimiter = rateLimit({
  windowMs: 60_000,
  max:      60,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } },
});

// Public: GET /api/report/:shareToken
router.get('/:shareToken', reportLimiter, getReport);

// Auth-required: GET /api/sessions/:id/share-token
// (registered under /api/sessions in app.ts)
export { getShareToken };

export default router;
