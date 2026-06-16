/**
 * features/user/types/index.ts
 *
 * Types for the user/profile domain.
 * User, Usage, UserStats, WeakArea, JobReadiness primitives live in @/types.
 */
import type { User, Usage, UserStats, WeakArea, JobReadiness } from '@/types';

/** Shape returned by GET /api/me */
export interface MeResponse {
  user:            User;
  usage:           Usage;
  stats:           UserStats;
  onboarding:      OnboardingStatus;
  job_readiness?:  JobReadiness;
  weak_areas?:     WeakArea[];
}

export interface OnboardingStatus {
  completed:    boolean;
  profession?:  string;
  goal?:        string;
}
