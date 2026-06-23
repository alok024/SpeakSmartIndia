/**
 * features/interview/api/index.ts
 *
 * HTTP calls for the interview/session domain — creating sessions,
 * fetching a session's detail, and generating a share link.
 */
import { apiCall } from '@/lib/api';
import type {
  CreateSessionPayload,
  CreateSessionResponse,
  SessionDetailResponse,
  ShareTokenResponse,
} from '../types';

// ── JD-questions ─────────────────────────────────────────────────────────────

export interface JdQuestionsPayload {
  jd_text:        string;
  profession:     string;
  interview_type: string;
  difficulty:     string;
  total_q:        number;
}

export interface JdQuestionsResponse {
  questions: string[];
}

// ── API object ────────────────────────────────────────────────────────────────

export const interviewApi = {
  createSession: (payload: CreateSessionPayload) =>
    apiCall<CreateSessionResponse>('/sessions', 'POST', payload),

  getSession: (id: string) =>
    apiCall<SessionDetailResponse>(`/sessions/${id}`),

  getShareToken: (sessionId: string) =>
    apiCall<ShareTokenResponse>(`/sessions/${sessionId}/share-token`),

  /** POST /api/interview/jd-questions — one Groq call, returns tailored string[].
   *  The caller falls back to default question generation on any non-ok result. */
  getJdQuestions: (payload: JdQuestionsPayload) =>
    apiCall<JdQuestionsResponse>('/interview/jd-questions', 'POST', payload),
};
