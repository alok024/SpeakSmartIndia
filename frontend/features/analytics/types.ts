
import type { Session } from '@/types';

/** GET /api/sessions */
export interface SessionsListResponse {
  sessions: Session[];
}

/** GET /api/sessions/score-history */
export interface ScoreHistoryResponse {
  history: Array<Session & { topic?: string }>;
}

/** Shape of a single readiness report row from the DB */
export interface ReadinessReport {
  id?:           string;
  user_id:       string;
  session_count: number;   // checkpoint: 5, 10, 15, …
  report_text:   string;
  avg_score?:    number | null;
  created_at?:   string;
}

/** GET /api/sessions/readiness-report */
export interface ReadinessReportResponse {
  report:                     ReadinessReport | null;
  total_sessions:             number;
  sessions_until_next_report: number;
}
