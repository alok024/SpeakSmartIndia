/**
 * features/analytics/api/index.ts
 *
 * HTTP calls for session history and progress analytics.
 */
import { apiCall } from '@/lib/api';
import type { SessionsListResponse, ScoreHistoryResponse } from '../types';

export const analyticsApi = {
  getSessions: () =>
    apiCall<SessionsListResponse>('/sessions'),

  getScoreHistory: (limit = 20) =>
    apiCall<ScoreHistoryResponse>(`/sessions/score-history?limit=${limit}`),
};
