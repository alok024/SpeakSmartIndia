/**
 * features/reports/types/index.ts
 *
 * Types for the public, unauthenticated shared-report page.
 * Session and Feedback primitives live in @/types.
 */
import type { Session, Feedback } from '@/types';

/** GET /api/report/:shareToken — public, no auth required */
export interface PublicReportResponse {
  session:       Session;
  feedbacks:     Feedback[];
  referral_code: string | null;
}
