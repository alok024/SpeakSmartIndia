/**
 * Supabase Database Client
 *
 * A typed wrapper around the Supabase REST API.
 * Every db.* method used anywhere in the codebase is implemented here.
 *
 * M9: Why this client always uses the service role key
 * Auth is custom (auth.service.ts issues our own JWTs), not Supabase Auth.
 * Postgres RLS policies built on `auth.uid()` only work with Supabase-Auth
 * JWTs that GoTrue/PostgREST can decode — our JWTs are not that, so
 * `SUPABASE_ANON_KEY` + per-user policies can't actually scope queries to
 * "the current user" without minting a second set of tokens.
 *
 * What actually enforces isolation: every user-scoped method below filters
 * explicitly by `user_id` as part of the query. That filter is the
 * access-control boundary — treat a missing one with the same gravity as
 * a missing auth check.
 *
 * As a defence-in-depth backstop, RLS is enabled with zero policies on
 * every table — see migrations/008_rls_default_deny.sql. Anon/authenticated
 * access is deny-by-default; only the service_role key (used exclusively
 * here) can read or write.
 */

// Re-export all row types so existing callers that import from client.ts
// don't need to change their import paths.
export type {
  UserRow,
  EmailVerificationTokenRow,
  EmailVerificationSendRow,
  UsageRow,
  StatsRow,
  SessionRow,
  FeedbackRow,
  SubscriptionRow,
  TokenBlacklistRow,
  PasswordResetRow,
  UserMistakeRow,
  WeakAreaRow,
  ScoreHistoryRow,
  ReferralEventRow,
  AnalyticsEventRow,
  B2BLeadRow,
  DailyQuestionRow,
  VoiceUsageLedgerRow,
  ReadinessReportRow,
  ScoreComparisonRow,
  ComparisonResponseRow,
  PushSubscriptionRow,
  PrepPathRow,
  UserPrepEnrollmentRow,
  ElaraSessionRow,
  ElaraVocabWordRow,
  PrepPathDay,
} from './base';

import { usersRepo }        from './users.repository';
import { sessionsRepo }     from './sessions.repository';
import { subscriptionsRepo } from './subscriptions.repository';
import { authRepo }         from './auth.repository';
import { onboardingRepo }   from './onboarding.repository';
import { adminRepo }        from './admin.repository';
import { analyticsRepo }    from './analytics.repository';
import { voiceRepo }        from './voice.repository';
import { featuresRepo }     from './features.repository';

export const db = {
  ...usersRepo,
  ...sessionsRepo,
  ...subscriptionsRepo,
  ...authRepo,
  ...onboardingRepo,
  ...adminRepo,
  ...analyticsRepo,
  ...voiceRepo,
  ...featuresRepo,
};
