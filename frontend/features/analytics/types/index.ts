/**
 * features/analytics/types/index.ts
 *
 * Types for session history and progress-over-time endpoints.
 * Session primitive lives in @/types.
 */
import type { Session } from '@/types';

/** GET /api/sessions */
export interface SessionsListResponse {
  sessions: Session[];
}

/** GET /api/sessions/score-history */
export interface ScoreHistoryResponse {
  history: Array<Session & { topic?: string }>;
}
