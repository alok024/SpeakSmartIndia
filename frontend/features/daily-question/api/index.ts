/**
 * features/daily-question/api/index.ts
 *
 * HTTP calls for the Daily Question Drop.
 */
import { apiCall } from '@/lib/api';
import type { DailyQuestionResponse } from '../types';

export const dailyQuestionApi = {
  get: () => apiCall<DailyQuestionResponse>('/ai/daily-question'),
};
