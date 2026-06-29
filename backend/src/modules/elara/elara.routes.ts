/**
 * modules/elara/elara.routes.ts
 *
 * POST /api/elara/debrief         — Pro+   spoken post-session summary
 * POST /api/elara/audit           — Elite  batch cross-session audit
 * GET  /api/elara/prefs           — any    read Hindi pref
 * PATCH /api/elara/prefs          — Elite  write Hindi pref
 *
 * — Elara session persistence (English Journey) —
 * POST /api/elara/sessions        — Pro+   save conversation scores at end
 * GET  /api/elara/sessions        — Pro+   English Journey history
 *
 * — Vocabulary tracker —
 * GET  /api/elara/vocab           — Pro+   saved vocab list
 * POST /api/elara/vocab/save      — Pro+   manually save a word
 * POST /api/elara/vocab/track     — Pro+   track errors from a message
 * GET  /api/elara/vocab/prompt    — Pro+   system-prompt reinforcement block
 */

import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware, requireVerified, requirePro } from '../../core/middleware';
import { db }       from '../../core/database/client';
import { forbidden } from '../../core/utils/response';
import {
  handleDebrief,
  handleAudit,
  getElaraPrefs,
  updateElaraPrefs,
  handleSaveSession,
  handleGetSessions,
  handleGetVocab,
  handleSaveVocabWord,
  handleTrackVocabErrors,
  handleVocabPrompt,
} from './elara.controller';

const router = Router();

// 10 Elara AI calls/minute per IP — full AI batch calls warrant a tighter limit
const elaraLimiter = rateLimit({
  windowMs: 60_000,
  max:      10,
  message:  { error: 'Too many Elara requests. Please wait a moment.' },
});

// Higher limit for lightweight vocab tracking (no AI involved)
const vocabLimiter = rateLimit({
  windowMs: 60_000,
  max:      60,
  message:  { error: 'Too many vocab tracking requests.' },
});

// Inline Elite guard — always checks DB, never trusts JWT plan field.
// getEffectivePlan() resolves elite_trial_expires_at so trial users pass the Pro gate
// (elite_trial_expires_at set, plan not yet 'elite').
async function requireElite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user        = req.user!;
    const dbUser      = await db.getUserById(user.id);
    const effectivePlan = dbUser ? db.getEffectivePlan(dbUser) : 'free';

    if (effectivePlan !== 'elite') {
      forbidden(res, 'This feature is exclusive to Elite subscribers.', 'elite_required');
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

// ── AI routes ──────────────────────────────────────────────────────────────

router.post('/debrief', authMiddleware, requireVerified, requirePro,  elaraLimiter, handleDebrief);
router.post('/audit',   authMiddleware, requireVerified, requireElite, elaraLimiter, handleAudit);

// ── Pref routes ────────────────────────────────────────────────────────────

router.get('/prefs',   authMiddleware,                                getElaraPrefs);
router.patch('/prefs', authMiddleware, requireVerified, requireElite, updateElaraPrefs);

// ── Session persistence routes (English Journey) ──────────────────────────

// POST saves the scores when a conversation ends; idempotent via client_session_id.
router.post('/sessions', authMiddleware, requireVerified, requirePro, vocabLimiter, handleSaveSession);
// GET returns the history for the "English Journey" dashboard chart.
router.get('/sessions',  authMiddleware, requireVerified, requirePro, handleGetSessions);

// ── Vocabulary tracker routes ─────────────────────────────────────────────

// List of saved words (dashboard + /english sidebar)
router.get('/vocab',           authMiddleware, requireVerified, requirePro, handleGetVocab);
// Manual save from the UI (user taps a word)
router.post('/vocab/save',     authMiddleware, requireVerified, requirePro, vocabLimiter, handleSaveVocabWord);
// Fire-and-forget error tracking after each AI message (no AI involved)
router.post('/vocab/track',    authMiddleware, requireVerified, requirePro, vocabLimiter, handleTrackVocabErrors);
// System prompt block to inject at conversation start
router.get('/vocab/prompt',    authMiddleware, requireVerified, requirePro, handleVocabPrompt);

export default router;
