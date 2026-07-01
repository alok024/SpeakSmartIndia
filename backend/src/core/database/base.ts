/**
 * Supabase database client — shared row types and the raw REST helper.
 *
 * Internal to core/database. Consumers import `db` from client.ts.
 *
 * Design rationale (why service-role key, not anon + RLS): see client.ts.
 */
import { AppError } from '../utils/errors';
import { env } from '../config/env';

export interface UserRow {
  id:             string;
  email:          string;
  password_hash:  string;
  plan:           string;
  name:           string;
  email_verified?: boolean;
  referral_code?: string;
  referred_by?:   string;
  referral_bonus?: number;
  onboarding_profession?:   string | null;
  onboarding_goal?:         string | null;
  onboarding_completed_at?: string | null;
  is_admin?:      boolean;
  // Set on password reset — authMiddleware rejects any token issued before this timestamp.
  // This invalidates all existing sessions without requiring individual token blacklisting.
  tokens_invalidated_at?: string | null;
  // Job-landed — set once when the user reports they got a job (migration 014).
  // job_landed_at non-null ↔ card hidden from dashboard.
  job_landed_at?:      string | null;
  job_landed_role?:    string | null;
  job_landed_company?: string | null;
  // P3-B: stores the raw SVG string of the last generated weekly progress card
  weekly_card_url?: string | null;
  // Migration 026: Base64 WAV of the Elara-voiced weekly summary (Pro+)
  weekly_card_voiced_url?: string | null;
  // Migration 019: HD voice preference toggle (paid users only; free always false)
  hd_voice_enabled?: boolean;
  // Migration 021: Elara Hindi/Hinglish explanation toggle (Elite only)
  elara_hindi_pref?: boolean;
  // Migration 026: streak milestone rewards tracking
  // jsonb keys: "7" | "30" | "60" | "90" → true once granted
  milestone_rewards_granted?: Record<string, boolean> | null;
  // Set to IST calendar date string (YYYY-MM-DD) on 30-day milestone; XP doubled that day
  xp_double_day?: string | null;
  // Set to ISO timestamp on 90-day milestone; effective_plan() returns 'elite' until expired
  elite_trial_expires_at?: string | null;
  // Shareable certificate URL minted on 60-day milestone
  streak60_cert_url?: string | null;
  // Migration 028: UPSC DAF (Detailed Application Form) fields.
  // Filled once in the profile page; injected into UPSC session prompts
  // to enable personalised questions ("You mentioned mountaineering…").
  daf_name?:                string | null;
  daf_home_state?:          string | null;
  daf_graduation_subject?:  string | null;
  daf_graduation_college?:  string | null;
  daf_optional_subject?:    string | null;
  daf_hobbies?:             string | null;  // comma-separated, max 3
  daf_work_experience?:     string | null;
  daf_extracurriculars?:    string | null;
  // Migration 028: last company target selected in campus interview mode.
  // Persisted so preference survives page reloads.
  last_company_mode?: string | null;
  created_at?:    string;
  updated_at?:    string;
}

export interface EmailVerificationTokenRow {
  id?:         string;
  user_id:     string;
  token_hash:  string;
  expires_at:  string;
  used:        boolean;
  created_at?: string;
}

export interface EmailVerificationSendRow {
  id?:      string;
  user_id:  string;
  sent_at?: string;
}

export interface UsageRow {
  user_id:      string;
  call_count:   number;
  period_start?: string;  // ISO timestamp — first day of current billing month (IST)
  // P1-A: monthly session cap (migration 018)
  monthly_session_count?:    number;     // sessions completed this IST month
  monthly_session_reset_at?: string;     // ISO timestamp of last monthly reset
  // Migration 025: referral bonus sessions (replaces users.referral_bonus AI-call system)
  monthly_session_bonus?:          number;  // extra sessions earned via referrals this month
  monthly_session_bonus_reset_at?: string;  // ISO timestamp of last bonus reset
  updated_at?:  string;
}

export interface StatsRow {
  user_id:                   string;
  streak:                    number;
  sessions:                  number;
  best_score:                number;
  total_score:               number;
  last_session?:             string;
  avg_job_ready_score?:      number;
  total_sessions_with_score?: number;
  clarity_avg?:              number;
  structure_avg?:            number;
  relevance_avg?:            number;
  grammar_avg?:              number;
  updated_at?:               string;
  // Migration 023: XP system
  xp_lifetime:               number;
  xp_monthly:                number;
  xp_reset_at?:              string;
  // Migration 024: weekly leaderboard
  xp_weekly:                 number;
  xp_weekly_reset_at?:       string;
  // Migration 024: streak freeze
  streak_freezes:            number;
  streak_freeze_reset_at?:   string;
  streak_freeze_unlocked:    boolean;
}

export interface SessionRow {
  id?:              string;
  client_session_id?: string;   // ← stable UUID from client; UNIQUE constraint prevents duplicate session rows on retry
  user_id:          string;
  status?:          'scoring' | 'completed' | 'abandoned';  // ← DB-enforced state machine column
  profession:       string;
  mode:             string;
  difficulty:       string;
  interview_type:   string;
  personality:      string;
  score:            number;
  exchanges:        number;
  duration_secs:    number;
  hindi_mode:       boolean;
  clarity_score?:   number;
  structure_score?: number;
  relevance_score?: number;
  grammar_score?:   number;
  job_ready_score?: number;
  // Easy build item — 2-3 sentence narrative summary in Aria's voice,
  // generated post-session by a background job. Null until that job
  // completes (or forever, if it failed — non-fatal by design).
  interviewer_notes?: string | null;
  created_at?:      string;
}

export interface FeedbackRow {
  id?:             string;
  session_id:      string | number;  // int8 in DB (PostgREST returns as string)
  question_index:  number;   // ← position in the session; forms the idempotency key with session_id
  question:        string;
  answer:          string;
  score:           number;
  corrections:     string;
  tips:            string;
  structure:       string;
  model_answer:    string;
  created_at?:     string;
}

export interface SubscriptionRow {
  id?:                  string;
  user_id:              string;
  plan:                 string;
  status:               string;
  razorpay_order_id:    string;
  razorpay_payment_id:  string;
  started_at:           string;
  expires_at:           string;
  created_at?:          string;
}

export interface TokenBlacklistRow {
  token_jti:  string;
  user_id:    string;
  expires_at: string;
}

export interface PasswordResetRow {
  id?:        string;
  user_id:    string;
  token:      string;
  expires_at: string;
  used:       boolean;
}

export interface UserMistakeRow {
  id?:          string;
  user_id:      string;
  topic:        string;
  mistake_type: string;
  description:  string;
  occurrences:  number;
}

export interface WeakAreaRow {
  user_id:        string;
  topic:          string;
  avg_score:      number;
  session_count:  number;
  last_practiced: string | null;
  updated_at?:    string;
}

export interface ScoreHistoryRow {
  id?:             string;
  user_id:         string;
  session_id:      string | number;  // int8 in DB (PostgREST returns as string)
  score:           number;
  job_ready_score: number;
  topic:           string;
  created_at?:     string;
}

export interface ReferralEventRow {
  id?:          string;
  referrer_id:  string;
  referred_id:  string;
  rewarded_at?: string | null;
  created_at?:  string;
}

export interface AnalyticsEventRow {
  id?:         string;
  user_id?:    string | null;
  session_id?: string | null;   // anonymous client session id (for pre-signup funnels)
  event:       string;          // e.g. 'page_view', 'signup', 'session_start', 'upgrade_click'
  properties?: Record<string, unknown> | null;
  path?:       string | null;
  plan?:       string | null;
  created_at?: string;
}

export interface B2BLeadRow {
  id:         string;
  name:       string;
  email:      string;
  org:        string;
  size:       string;
  org_type:   string | null;
  message:    string | null;
  status:     string;   // new | contacted | qualified | closed
  created_at: string;
}

export interface DailyQuestionRow {
  date:       string; // 'YYYY-MM-DD'
  question:   string;
  profession: string;
  created_at: string;
}

export interface VoiceUsageLedgerRow {
  id?:                  string;
  user_id:              string;
  billing_month:        string; // 'YYYY-MM-DD' (first day of IST month)
  voice_seconds_used:   number;
  avatar_seconds_used:  number;
  bonus_voice_seconds:  number;
  created_at?:          string;
  updated_at?:          string;
}

export interface ReadinessReportRow {
  id?:            string;
  user_id:        string;
  session_count:  number;   // checkpoint this report covers (5, 10, 15, ...)
  report_text:    string;
  avg_score?:     number | null;
  created_at?:    string;
}

export interface ScoreComparisonRow {
  id?:             string;
  session_id:      string | number;  // int8 in DB (PostgREST returns as string)
  user_id:         string;
  question_index:  number;
  question_text:   string;
  sharer_answer:   string;
  sharer_score:    number;
  share_token:     string;
  expires_at?:     string;
  created_at?:     string;
}

export interface PushSubscriptionRow {
  id?:        string;
  user_id:    string;
  endpoint:   string;
  p256dh:     string;
  auth:       string;
  created_at?: string;
}

// FCM registration token for a native (iOS/Android) client. Kept separate
// from PushSubscriptionRow — Web Push subscriptions and FCM tokens are
// different protocols with different shapes, and a single token can move
// between accounts (logout/login on the same device), which is why this
// is keyed by token, not (user_id, token).
export interface DeviceTokenRow {
  id?:         string;
  user_id:     string;
  token:       string;
  platform:    'ios' | 'android';
  created_at?: string;
  updated_at?: string;
}

export interface ComparisonResponseRow {
  id?:                string;
  comparison_id:      string;
  challenger_name?:   string | null;
  challenger_answer:  string;
  challenger_score:   number;
  ai_feedback?:       string | null;
  created_at?:        string;
}

export interface PrepPathDay {
  day_number: number;
  title: string;
  session_config: {
    profession: string;
    mode: string;
    difficulty: string;
    interview_type: string;
  };
}

export interface PrepPathRow {
  id:            string;  // slug, e.g. 'bank-po-7day'
  title:         string;
  description:   string;
  duration_days: number;
  profession:    string;
  days:          PrepPathDay[];
  is_active?:    boolean;
  created_at?:   string;
}

export interface UserPrepEnrollmentRow {
  id?:           string;
  user_id:       string;
  prep_path_id:  string;
  enrolled_at?:  string;
  completed_at?: string | null;
  created_at?:   string;
}

export interface ElaraSessionRow {
  id?:               string;
  user_id:           string;
  client_session_id: string;
  grammar_score?:    number | null;
  fluency_score?:    number | null;
  vocab_score?:      number | null;
  message_count:     number;
  mode:              string;
  created_at?:       string;
}

export interface ElaraVocabWordRow {
  id?:                  string;
  user_id:              string;
  wrong_form:           string;
  correct_form:         string;
  rule?:                string | null;
  occurrences:          number;
  auto_saved:           boolean;
  manually_saved:       boolean;
  last_reinforced_at?:  string | null;
  created_at?:          string;
  updated_at?:          string;
}

// Raw Supabase REST helper

// ── Supabase REST helper ──────────────────────────────────────────────────────

export async function sb<T = unknown>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body: unknown = null,
  opts_: { extraHeaders?: Record<string, string> } = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const opts: RequestInit = {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer':        'return=representation',
      ...(opts_.extraHeaders ?? {}),
    },
  };
  if (body !== null) opts.body = JSON.stringify(body);

  const res  = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, opts);
  const raw  = await res.text();
  const data = (raw ? JSON.parse(raw) : null) as T;
  return { ok: res.ok, status: res.status, data };
}

// Database client
