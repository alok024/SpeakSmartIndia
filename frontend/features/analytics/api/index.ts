/**
 * features/analytics/api/index.ts
 *
 * HTTP calls for session history and progress analytics.
 */
import { apiCall } from '@/lib/api';
import type { SessionsListResponse, ScoreHistoryResponse, ReadinessReportResponse } from '../types';

export const analyticsApi = {
  getSessions: () =>
    apiCall<SessionsListResponse>('/sessions'),

  getScoreHistory: (limit = 20) =>
    apiCall<ScoreHistoryResponse>(`/sessions/score-history?limit=${limit}`),

  getReadinessReport: () =>
    apiCall<ReadinessReportResponse>('/sessions/readiness-report'),

  getReadinessCertificateToken: () =>
    apiCall<{ token: string; cert_url: string }>('/sessions/readiness-report/certificate-token'),

  getLeaderboard: () =>
    apiCall<{
      entries: Array<{ rank: number; display_name: string; xp_weekly: number; xp_lifetime: number; streak: number }>;
      me: {
        rank: number | null;
        xp_weekly: number;
        xp_lifetime: number;
        streak: number;
        in_top_50: boolean;
        is_competitive: boolean;   // false for Free/Starter → show blur/upsell
      };
      resets_next_sunday: boolean;
    }>('/leaderboard'),
};
