import { Request, Response } from 'express';
import { asyncHandler } from '../../../core/middleware';
import { ok } from '../../../core/utils/response';
import { getTodaysDailyQuestion } from './daily-question.service';

// GET /api/ai/daily-question
// Read-only, no usage-quota gate — see the comment on this route's
// registration in ai.routes.ts for why.
//
// Always returns 200. `question` is null if today's question hasn't
// been generated yet and generation just failed — the dashboard treats
// a null/missing question as "render nothing", not an error state.
export const handleDailyQuestion = asyncHandler(async (_req: Request, res: Response) => {
  const daily = await getTodaysDailyQuestion();

  ok(res, {
    question:   daily?.question ?? null,
    profession: daily?.profession ?? null,
    date:       daily?.date ?? null,
  });
});
