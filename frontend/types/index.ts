// Core domain types — mirror backend exactly

export type Plan = 'free' | 'pro' | 'elite';
export type SessionMode = 'classic' | 'chat';
export type Difficulty = 'beginner' | 'intermediate' | 'expert';
export type InterviewType = 'Technical' | 'Behavioral' | 'Mixed';
export type Persona = 'friendly' | 'strict' | 'encouraging';

export interface User {
  id: string;
  email: string;
  name: string;
  plan: Plan;
  email_verified: boolean;
  referral_code?: string;
  referral_bonus?: number;
  ai_calls?: number;
  /** null = unlimited (pro/elite); populated from usage.limit in /me response */
  ai_calls_limit?: number | null;
  /** null = unlimited; populated from usage.remaining in /me response */
  ai_calls_remaining?: number | null;
  onboarding_profession?: string | null;
  onboarding_goal?: string | null;
  onboarding_completed_at?: string | null;
  is_admin?: boolean;
  created_at?: string;
}

export interface Usage {
  ai_calls: number;
  call_count?: number;
  /** null means unlimited (pro/elite) */
  limit?: number | null;
  remaining?: number | null;
}

export interface UserStats {
  streak: number;
  sessions: number;
  best_score: number;
  last_session?: string;
  avg_job_ready_score?: number;
}

export interface Session {
  id: string;
  user_id: string;
  profession: string;
  mode: SessionMode;
  difficulty: Difficulty;
  interview_type: InterviewType;
  personality: Persona;
  score: number;
  exchanges: number;
  duration_secs: number;
  hindi_mode: boolean;
  job_ready_score?: number;
  clarity_score?: number;
  structure_score?: number;
  relevance_score?: number;
  grammar_score?: number;
  created_at: string;
}

export interface Feedback {
  id: string;
  session_id: string;
  question: string;
  answer?: string;
  score: number;
  tips?: string;
  corrections?: ErrorCorrection[];
  interview_feedback?: string;
  english_errors?: ErrorCorrection[];
  corrected_answer?: string | null;
  structure?: StructureFeedback;
  model_answer?: ModelAnswer;
  tip?: string;
}

export interface ErrorCorrection {
  mistake?: string;
  wrong?: string;
  correction?: string;
  correct?: string;
  explanation?: string;
  rule?: string;
}

export interface StructureFeedback {
  type: string;
  score: number;
  present_parts: string[];
  missing_parts: string[];
  fix: string;
}

export interface ModelAnswer {
  good: string;
  great: string;
}

export interface WeakArea {
  topic: string;
  avg_score: number;
  drill_prompt?: string;
}

export interface JobReadiness {
  score: number;
  label: string;
  color: string;
  message: string;
}

export interface ReferralData {
  code: string;
  uses: number;
  rewarded: number;
  bonus_calls: number;
}

// API response wrapper

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  status: number;
  // L4: request_id correlates this error with backend logs/Sentry — see
  // lib/api.ts's extractErrorMessage / withErrorRef, which surface it to
  // the user as a support reference ("Error ref: abc123").
  error: { code: string; message: string; request_id?: string } | string;
}

export type ApiResult<T> = ApiOk<T> | ApiErr;

// Interview session state (live, not persisted)

export interface LiveSessionConfig {
  profession: string;
  mode: SessionMode;
  interviewType: InterviewType;
  difficulty: Difficulty;
  totalQ: number;
  timerSecs: number;
  persona: Persona;
  maxExchanges: number;
  lang: 'en' | 'hi' | 'hinglish';
}

export interface LiveSessionState {
  questions: string[];
  currentQ: number;
  allFeedbacks: Feedback[];
  allErrors: ErrorCorrection[];
  chatHistory: { role: 'user' | 'assistant'; content: string }[];
  chatExchanges: number;
  chatErrors: ErrorCorrection[];
  sessionStartTime: number | null;
  timerRemaining: number;
  clientSessionId: string | null;
  lastSessionId: string | null;
  voiceReplies: boolean;
}

// Onboarding

export interface OnboardingState {
  done: boolean;
  profession?: string;
  goal?: string;
}

// Upgrade modal

export type UpgradeTrigger =
  | 'limit_hit'
  | 'feature_lock'
  | 'voice_fallback'
  | 'strip'
  | 'nudge'
  | 'session_end'
  | null;
