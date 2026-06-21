/**
 * features/daily-question/types/index.ts
 *
 * Types for the Daily Question Drop (GET /api/ai/daily-question).
 */
export interface DailyQuestionResponse {
  question:   string | null;
  profession: string | null;
  date:       string | null;
}
