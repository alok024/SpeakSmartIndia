/**
 * features/interview/schemas/index.ts
 *
 * Validation for interview setup form inputs.
 */
import { z } from 'zod';

export const InterviewSetupSchema = z.object({
  profession:     z.string().min(1, 'Choose a profession'),
  mode:           z.enum(['classic', 'chat']),
  interviewType:  z.enum(['Technical', 'Behavioral', 'Mixed']),
  difficulty:     z.enum(['beginner', 'intermediate', 'expert']),
  totalQ:         z.number().int().min(1).max(20),
  timerSecs:      z.number().int().min(30).max(300),
  persona:        z.enum(['friendly', 'strict', 'encouraging']),
  maxExchanges:   z.number().int().min(3).max(30),
  lang:           z.enum(['en', 'hi', 'hinglish']),
});

export type InterviewSetupData = z.infer<typeof InterviewSetupSchema>;
