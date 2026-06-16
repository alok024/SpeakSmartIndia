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

export const interviewApi = {
  createSession: (payload: CreateSessionPayload) =>
    apiCall<CreateSessionResponse>('/sessions', 'POST', payload),

  getSession: (id: string) =>
    apiCall<SessionDetailResponse>(`/sessions/${id}`),

  getShareToken: (sessionId: string) =>
    apiCall<ShareTokenResponse>(`/sessions/${sessionId}/share-token`),
};
