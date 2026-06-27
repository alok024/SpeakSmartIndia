/**
 * features/user/api/index.ts
 *
 * HTTP calls for the user/profile domain.
 */
import { apiCall } from '@/lib/api';
import type { MeResponse } from '../types';
import type { ReferralData } from '@/types';

export interface DAFProfile {
  name?:               string | null;
  home_state?:         string | null;
  graduation_subject?: string | null;
  graduation_college?: string | null;
  optional_subject?:   string | null;
  hobbies?:            string | null;
  work_experience?:    string | null;
  extracurriculars?:   string | null;
}

export const userApi = {
  me: () =>
    apiCall<MeResponse>('/me'),

  completeOnboarding: (profession: string, goal: string) =>
    apiCall('/onboarding', 'POST', { profession, goal }),

  getReferral: () =>
    apiCall<ReferralData>('/referral'),

  getDAF: () =>
    apiCall<DAFProfile>('/daf'),

  saveDAF: (fields: DAFProfile) =>
    apiCall('/daf', 'POST', fields),

  saveCompanyMode: (company_mode: string | null) =>
    apiCall('/company-mode', 'POST', { company_mode }),
};
