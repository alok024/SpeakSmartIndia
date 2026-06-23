/**
 * features/speech/api/index.ts
 *
 * HTTP calls for the speech-metrics endpoints.
 */
import { apiCall } from '@/lib/api';

export interface SaveSpeechMetricsPayload {
  client_session_id: string;
  filler_count:      number;
  wpm:               number;
  answer_count:      number;
}

export interface SpeechTrendPoint {
  created_at:   string;
  filler_count: number;
  wpm:          number;
  answer_count: number;
}

export interface SpeechTrendResponse {
  trend: SpeechTrendPoint[];
}

export const speechApi = {
  /**
   * POST /api/speech-metrics
   * Fire-and-forget safe: caller never needs to await this.
   */
  save: (payload: SaveSpeechMetricsPayload) =>
    apiCall<{ saved: boolean }>('/speech-metrics', 'POST', payload),

  /**
   * GET /api/speech-metrics
   * Returns oldest-first trend data for the dashboard chart.
   */
  getTrend: (limit = 20) =>
    apiCall<SpeechTrendResponse>(`/speech-metrics?limit=${limit}`),
};
