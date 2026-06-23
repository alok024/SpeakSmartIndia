/**
 * features/interview/schemas/index.ts
 *
 * Validation for interview setup form inputs.
 *
 * The four enum sub-schemas (mode, interviewType, difficulty, persona) are
 * imported from @shared so they cannot drift from the backend definitions or
 * the shared API schemas that describe the same values.
 */
import { z } from 'zod';
import {
  SessionModeSchema,
  InterviewTypeSchema,
  DifficultySchema,
  PersonaSchema,
} from '@shared/schemas/api.schemas';

export const InterviewSetupSchema = z.object({
  profession:     z.string().min(1, 'Choose a profession'),
  mode:           SessionModeSchema,
  interviewType:  InterviewTypeSchema,
  difficulty:     DifficultySchema,
  totalQ:         z.number().int().min(1).max(20),
  timerSecs:      z.number().int().min(30).max(300),
  persona:        PersonaSchema,
  maxExchanges:   z.number().int().min(3).max(30),
  lang:           z.enum(['en', 'hi', 'hinglish']),
});

export type InterviewSetupData = z.infer<typeof InterviewSetupSchema>;
