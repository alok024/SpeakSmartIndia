/**
 * features/user/api/index.ts
 *
 * HTTP calls for the user/profile domain.
 */
import { apiCall } from '@/lib/api';
import type { MeResponse } from '../types';
import type { ReferralData } from '@/types';

export const userApi = {
  me: () =>
    apiCall<MeResponse>('/me'),

  completeOnboarding: (profession: string, goal: string) =>
    apiCall('/onboarding', 'POST', { profession, goal }),

  getReferral: () =>
    apiCall<ReferralData>('/referral'),
};
