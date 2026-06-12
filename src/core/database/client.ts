/**
 * Supabase Database Client
 *
 * A typed wrapper around the Supabase REST API.
 * Every db.* method used anywhere in the codebase is implemented here.
 * Uses the service role key → bypasses RLS.
 */

import { env } from '../config/env';

// ── DB Row types ──────────────────────────────────────────────────

export interface UserRow {
  id:             string;
  email:          string;
  password_hash:  string;
  plan:           string;
  name:           string;
  referral_code?: string;
  referred_by?:   string;
  referral_bonus?: number;
  created_at?:    string;
  updated_at?:    string;
}

export interface UsageRow {
  user_id:    string;
  call_count: number;
  updated_at?: string;
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
}

export interface SessionRow {
  id?:             string;
  user_id:         string;
  profession:      string;
  mode:            string;
  difficulty:      string;
  interview_type:  string;
  personality:     string;
  score:           number;
  exchanges:       number;
  duration_secs:   number;
  hindi_mode:      boolean;
  clarity_score?:  number;
  structure_score?: number;
  relevance_score?: number;
  grammar_score?:  number;
  job_ready_score?: number;
  created_at?:     string;
}

export interface FeedbackRow {
  id?:          string;
  session_id:   string;
  question:     string;
  answer:       string;
  score:        number;
  corrections:  string;
  tips:         string;
  structure:    string;
  model_answer: string;
  created_at?:  string;
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
  session_id:      string;
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

// ── Raw Supabase REST helper ──────────────────────────────────────

async function sb<T = unknown>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body: unknown = null
): Promise<{ ok: boolean; status: number; data: T }> {
  const opts: RequestInit = {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer':        'return=representation',
    },
  };
  if (body !== null) opts.body = JSON.stringify(body);

  const res  = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, opts);
  const raw  = await res.text();
  const data = (raw ? JSON.parse(raw) : null) as T;
  return { ok: res.ok, status: res.status, data };
}

// ── Database client ───────────────────────────────────────────────

export const db = {

  // ── Users ───────────────────────────────────────────────────────

  async getUserByEmail(email: string): Promise<UserRow | null> {
    const { data } = await sb<UserRow[]>(`/users?email=eq.${encodeURIComponent(email)}&select=*`);
    return data?.[0] ?? null;
  },

  async getUserById(id: string): Promise<UserRow | null> {
    const { data } = await sb<UserRow[]>(`/users?id=eq.${id}&select=*`);
    return data?.[0] ?? null;
  },

  async getUserByReferralCode(code: string): Promise<UserRow | null> {
    const { data } = await sb<UserRow[]>(`/users?referral_code=eq.${encodeURIComponent(code)}&select=*`);
    return data?.[0] ?? null;
  },

  async createUser(input: Omit<UserRow, 'id' | 'created_at' | 'updated_at'>): Promise<UserRow> {
    const { data, ok } = await sb<UserRow[]>('/users', 'POST', input);
    if (!ok || !data?.[0]) throw new Error('Failed to create user');
    return data[0];
  },

  async updateUser(id: string, updates: Partial<UserRow>): Promise<void> {
    await sb(`/users?id=eq.${id}`, 'PATCH', updates);
  },

  async setReferralCode(userId: string, code: string): Promise<void> {
    const { ok } = await sb(`/users?id=eq.${userId}`, 'PATCH', { referral_code: code });
    if (!ok) throw new Error('Failed to set referral code (may be duplicate)');
  },

  async setReferredBy(userId: string, code: string): Promise<void> {
    await sb(`/users?id=eq.${userId}`, 'PATCH', { referred_by: code });
  },

  async addBonusCalls(userId: string, amount: number): Promise<void> {
    // Use RPC for atomic increment — avoids the read-then-write race condition
    // where two concurrent referral rewards both read 0 and both write 10 instead of 20.
    await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/increment_referral_bonus`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_user_id: userId, p_amount: amount }),
    });
  },

  // ── Usage ───────────────────────────────────────────────────────

  async getUsage(userId: string): Promise<UsageRow | null> {
    const { data } = await sb<UsageRow[]>(`/usage?user_id=eq.${userId}&select=*`);
    return data?.[0] ?? null;
  },

  async upsertUsage(userId: string, callCount: number): Promise<void> {
    const existing = await db.getUsage(userId);
    if (existing) {
      await sb(`/usage?user_id=eq.${userId}`, 'PATCH', { call_count: callCount, updated_at: new Date().toISOString() });
    } else {
      await sb('/usage', 'POST', { user_id: userId, call_count: callCount });
    }
  },

  /**
   * Atomically increments usage via a Supabase RPC to avoid the
   * read-then-write race condition where two concurrent requests
   * both read the same call_count and both write callCount+1.
   *
   * Requires this function in Supabase SQL:
   *   CREATE OR REPLACE FUNCTION increment_usage(p_user_id uuid)
   *   RETURNS void LANGUAGE sql AS $$
   *     INSERT INTO usage (user_id, call_count, updated_at)
   *     VALUES (p_user_id, 1, now())
   *     ON CONFLICT (user_id)
   *     DO UPDATE SET call_count = usage.call_count + 1, updated_at = now();
   *   $$;
   */
  async incrementUsage(userId: string): Promise<void> {
    await sb('/rpc/increment_usage', 'POST', { p_user_id: userId });
  },

  async resetUsage(userId: string): Promise<void> {
    await sb(`/usage?user_id=eq.${userId}`, 'PATCH', {
      call_count: 0,
      updated_at: new Date().toISOString(),
    });
  },

  // ── Stats ───────────────────────────────────────────────────────

  async getStats(userId: string): Promise<StatsRow | null> {
    const { data } = await sb<StatsRow[]>(`/stats?user_id=eq.${userId}&select=*`);
    return data?.[0] ?? null;
  },

  async upsertStats(userId: string, updates: Partial<StatsRow>): Promise<void> {
    const existing = await db.getStats(userId);
    if (existing) {
      await sb(`/stats?user_id=eq.${userId}`, 'PATCH', { ...updates, updated_at: new Date().toISOString() });
    } else {
      await sb('/stats', 'POST', { user_id: userId, ...updates });
    }
  },

  // ── Sessions ────────────────────────────────────────────────────

  async createSession(input: Omit<SessionRow, 'id' | 'created_at'>): Promise<SessionRow> {
    const { data, ok } = await sb<SessionRow[]>('/sessions', 'POST', input);
    if (!ok || !data?.[0]) throw new Error('Failed to create session');
    return data[0];
  },

  async getUserSessions(userId: string, limit: number, offset: number): Promise<SessionRow[]> {
    const { data } = await sb<SessionRow[]>(
      `/sessions?user_id=eq.${userId}&order=created_at.desc&limit=${limit}&offset=${offset}&select=*`
    );
    return data ?? [];
  },

  async getSessionById(sessionId: string, userId: string): Promise<SessionRow | null> {
    const { data } = await sb<SessionRow[]>(
      `/sessions?id=eq.${sessionId}&user_id=eq.${userId}&select=*`
    );
    return data?.[0] ?? null;
  },

  /** Used by weak_areas.service — no user_id restriction, returns score + topic */
  async getUserSessionsForWeakAreas(userId: string): Promise<Array<Pick<SessionRow, 'score' | 'interview_type' | 'profession' | 'created_at'>>> {
    const { data } = await sb<SessionRow[]>(
      `/sessions?user_id=eq.${userId}&order=created_at.desc&limit=100&select=score,interview_type,profession,created_at`
    );
    return (data ?? []) as Array<Pick<SessionRow, 'score' | 'interview_type' | 'profession' | 'created_at'>>;
  },

  // ── Feedback ────────────────────────────────────────────────────

  async createFeedback(input: Omit<FeedbackRow, 'id' | 'created_at'>): Promise<void> {
    await sb('/feedback', 'POST', input);
  },

  async getSessionFeedback(sessionId: string): Promise<FeedbackRow[]> {
    const { data } = await sb<FeedbackRow[]>(
      `/feedback?session_id=eq.${sessionId}&select=*&order=created_at.asc`
    );
    return data ?? [];
  },

  // ── Subscriptions ───────────────────────────────────────────────

  async createSubscription(input: Omit<SubscriptionRow, 'id' | 'created_at'>): Promise<void> {
    await sb('/subscriptions', 'POST', input);
  },

  async getActiveSubscription(userId: string): Promise<SubscriptionRow | null> {
    const { data } = await sb<SubscriptionRow[]>(
      `/subscriptions?user_id=eq.${userId}&status=eq.active&order=created_at.desc&limit=1&select=*`
    );
    return data?.[0] ?? null;
  },

  async getSubscriptionByPaymentId(paymentId: string): Promise<SubscriptionRow | null> {
    const { data } = await sb<SubscriptionRow[]>(
      `/subscriptions?razorpay_payment_id=eq.${paymentId}&select=*`
    );
    return data?.[0] ?? null;
  },

  async updateSubscription(id: string, updates: Partial<SubscriptionRow>): Promise<void> {
    await sb(`/subscriptions?id=eq.${id}`, 'PATCH', updates);
  },

  async getExpiredActiveSubscriptions(): Promise<SubscriptionRow[]> {
    const now = new Date().toISOString();
    const { data } = await sb<SubscriptionRow[]>(
      `/subscriptions?status=eq.active&expires_at=lt.${now}&select=*`
    );
    return data ?? [];
  },

  // ── Token blacklist ─────────────────────────────────────────────

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const { data } = await sb<TokenBlacklistRow[]>(
      `/token_blacklist?token_jti=eq.${jti}&select=token_jti`
    );
    return !!(data && data.length > 0);
  },

  async blacklistToken(input: TokenBlacklistRow): Promise<void> {
    await sb('/token_blacklist', 'POST', input);
  },

  // ── Password resets ─────────────────────────────────────────────

  async createPasswordReset(input: Omit<PasswordResetRow, 'id' | 'used'>): Promise<void> {
    await sb('/password_resets', 'POST', { ...input, used: false });
  },

  async getPasswordReset(token: string): Promise<PasswordResetRow | null> {
    const { data } = await sb<PasswordResetRow[]>(
      `/password_resets?token=eq.${token}&used=eq.false&select=*`
    );
    return data?.[0] ?? null;
  },

  async markPasswordResetUsed(id: string): Promise<void> {
    await sb(`/password_resets?id=eq.${id}`, 'PATCH', { used: true });
  },

  async invalidatePasswordResets(userId: string): Promise<void> {
    // Mark all existing unused resets as used before issuing a new one
    // Prevents token accumulation and multiple valid reset links floating around
    await sb(`/password_resets?user_id=eq.${userId}&used=eq.false`, 'PATCH', { used: true });
  },

  // ── User mistakes (AI memory) ───────────────────────────────────

  async getUserMistakes(userId: string, topic: string): Promise<UserMistakeRow[]> {
    const { data } = await sb<UserMistakeRow[]>(
      `/user_mistakes?user_id=eq.${userId}&topic=eq.${encodeURIComponent(topic)}&order=occurrences.desc&limit=10&select=*`
    );
    return data ?? [];
  },

  /**
   * Upsert a mistake — increment occurrences if the exact same
   * (user_id, topic, mistake_type, description) already exists.
   * Uses a Postgres RPC so it's atomic.
   */
  async rpc_upsert_mistake(params: {
    p_user_id:      string;
    p_topic:        string;
    p_mistake_type: string;
    p_description:  string;
  }): Promise<void> {
    // Call the Supabase RPC function we create in migration.sql
    await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/upsert_user_mistake`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify(params),
    });
  },

  // ── Weak areas ──────────────────────────────────────────────────

  async getWeakAreas(userId: string): Promise<WeakAreaRow[]> {
    const { data } = await sb<WeakAreaRow[]>(
      `/weak_areas?user_id=eq.${userId}&order=avg_score.asc&select=*`
    );
    return data ?? [];
  },

  async upsertWeakAreas(userId: string, entries: WeakAreaRow[]): Promise<void> {
    // Delete existing rows for this user then insert fresh — simpler than per-row upsert
    await sb(`/weak_areas?user_id=eq.${userId}`, 'DELETE');
    if (entries.length > 0) {
      await sb('/weak_areas', 'POST', entries);
    }
  },

  // ── Score history ───────────────────────────────────────────────

  async addScoreHistory(input: Omit<ScoreHistoryRow, 'id' | 'created_at'>): Promise<void> {
    await sb('/score_history', 'POST', input);
  },

  async getScoreHistory(userId: string, limit: number): Promise<ScoreHistoryRow[]> {
    const { data } = await sb<ScoreHistoryRow[]>(
      `/score_history?user_id=eq.${userId}&order=created_at.desc&limit=${limit}&select=*`
    );
    return data ?? [];
  },

  // ── Referral events ─────────────────────────────────────────────

  async createReferralEvent(referrerId: string, referredId: string): Promise<void> {
    await sb('/referral_events', 'POST', { referrer_id: referrerId, referred_id: referredId });
  },

  /**
   * Returns a referral event for `referredId` that has NOT yet been rewarded.
   * Used in maybeRewardReferrer — returns null if user was not referred or
   * already rewarded.
   */
  async getPendingReferralEvent(referredId: string): Promise<ReferralEventRow | null> {
    const { data } = await sb<ReferralEventRow[]>(
      `/referral_events?referred_id=eq.${referredId}&rewarded_at=is.null&select=*&limit=1`
    );
    return data?.[0] ?? null;
  },

  async markReferralRewarded(eventId: string): Promise<void> {
    await sb(`/referral_events?id=eq.${eventId}`, 'PATCH', { rewarded_at: new Date().toISOString() });
  },

  async getReferralStats(referrerId: string): Promise<{ uses: number; rewarded: number; bonus_calls: number }> {
    const { data } = await sb<ReferralEventRow[]>(
      `/referral_events?referrer_id=eq.${referrerId}&select=*`
    );
    const events = data ?? [];
    const user   = await db.getUserById(referrerId);
    return {
      uses:        events.length,
      rewarded:    events.filter(e => e.rewarded_at != null).length,
      bonus_calls: (user as unknown as Record<string, number>)?.referral_bonus ?? 0,
    };
  },
};
