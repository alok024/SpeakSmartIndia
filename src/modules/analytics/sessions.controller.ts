import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import {
  saveSession,
  listSessions,
  getSessionDetail,
  getScoreHistory,
} from './sessions.service';

// POST /api/sessions
export const createSession = asyncHandler(async (req: Request, res: Response) => {
  const result = await saveSession({
    userId:         req.user!.id,
    profession:     String(req.body.profession     || 'General'),
    mode:           String(req.body.mode           || 'classic'),
    difficulty:     String(req.body.difficulty     || 'beginner'),
    interview_type: String(req.body.interview_type || 'mixed'),
    personality:    String(req.body.personality    || 'friendly'),
    score:          Number(req.body.score)          || 0,
    exchanges:      Number(req.body.exchanges)      || 0,
    duration_secs:  Number(req.body.duration_secs)  || 0,
    hindi_mode:     Boolean(req.body.hindi_mode),
    feedbacks:      req.body.feedbacks as Parameters<typeof saveSession>[0]['feedbacks'],
  });

  res.json({ success: true, ...result });
});

// GET /api/sessions
export const getSessions = asyncHandler(async (req: Request, res: Response) => {
  const page    = Math.max(1, parseInt(req.query.page     as string) || 1);
  const perPage = Math.min(50, parseInt(req.query.per_page as string) || 10);

  const result = await listSessions(req.user!.id, page, perPage);
  res.json(result);
});

// GET /api/sessions/score-history  (must be before /:id)
export const scoreHistory = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(100, parseInt(req.query.limit as string) || 30);
  const data  = await getScoreHistory(req.user!.id, limit);
  res.json({ history: data });
});

// GET /api/sessions/:id
export const getSession = asyncHandler(async (req: Request, res: Response) => {
  const detail = await getSessionDetail(req.params.id, req.user!.id);

  if (!detail) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(detail);
});
