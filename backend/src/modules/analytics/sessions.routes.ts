import { Router } from 'express';
import { authMiddleware, requireVerified, requireOnboarded, requirePro, validateUUIDParam } from '../../core/middleware';
import {
  createSession,
  getSessions,
  getSession,
  scoreHistory,
} from './sessions.controller';
import { getShareToken } from '../reports/reports.routes';

const router = Router();

// requireOnboarded: sessions are meaningless without profession/goal context
router.post('/',               authMiddleware, requireVerified, requireOnboarded, createSession);
// Fix (#22): history/page.tsx presents full session history as a
// Pro-only paywalled feature, but GET / had no requirePro check — any
// free user could bypass the paywall with a direct API call.
//
// score-history is intentionally left open: dashboard/page.tsx's "Recent
// Sessions" widget calls it unconditionally for all users (not gated by
// isFree), so adding requirePro here would break that for free users —
// confirmed by checking how each endpoint is actually consumed before
// changing behavior, per the bug note to "decide policy first."
router.get('/',                authMiddleware, requireVerified, requirePro, getSessions);
router.get('/score-history',   authMiddleware, requireVerified, scoreHistory);
router.get('/:id/share-token', authMiddleware, requireVerified, validateUUIDParam('id'), getShareToken);
router.get('/:id',             authMiddleware, requireVerified, validateUUIDParam('id'), getSession);

export default router;
