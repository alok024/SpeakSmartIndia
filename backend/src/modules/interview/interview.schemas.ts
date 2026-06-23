/**
 * modules/interview/interview.schemas.ts
 *
 * Zod request body schemas for interview-specific endpoints.
 * Auth/AI schemas that cross modules live in core/utils/schemas.ts.
 */

import { z } from 'zod';

// POST /api/interview/jd-questions
//
// jd_text is the raw paste from a job description. We cap at 4,000 chars
// (≈ 800–1,000 tokens) — a real JD is rarely longer, and anything larger
// is almost certainly a prompt-injection attempt or a copy-paste accident.
// profession, interview_type, difficulty, and total_q mirror the setup
// screen config so the generated questions match the session settings.
export const JdQuestionsSchema = z.object({
  jd_text:        z.string().min(20, 'Job description is too short').max(4_000, 'Job description exceeds 4,000 characters'),
  profession:     z.string().min(1).max(100).default('General'),
  interview_type: z.string().min(1).max(50).default('Mixed'),
  difficulty:     z.string().min(1).max(50).default('beginner'),
  total_q:        z.number().int().min(1).max(20).default(5),
});

export type JdQuestionsDTO = z.infer<typeof JdQuestionsSchema>;
