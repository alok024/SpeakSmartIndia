/**
 * hooks/queries.ts — compatibility re-export shim
 *
 * All hooks have moved to their respective feature modules.
 * This file re-exports them so existing page imports don't break.
 * Migrate imports gradually: '@/hooks/queries' → the feature path below.
 *
 * Auth:      @/features/auth/hooks
 * User:      @/features/user/hooks
 * Analytics: @/features/analytics/hooks
 * Interview: @/features/interview/hooks
 * Payment:   @/features/payment/hooks
 */
export { useLogin, useRegister, useLogout } from '@/features/auth/hooks';
export { useMe, useCompleteOnboarding, useReferral } from '@/features/user/hooks';
export { useSessions, useScoreHistory, useReadinessReport, useLeaderboard } from '@/features/analytics/hooks';
export { useSaveSession, useSession } from '@/features/interview/hooks';
export { useCreateOrder, useVerifyPayment } from '@/features/payment/hooks';
export { QK } from '@/lib/query-keys';
