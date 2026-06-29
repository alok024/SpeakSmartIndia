import { AppError } from '../utils/errors';
import { env } from '../config/env';
import { sb } from './base';
import type { UserRow, UsageRow, StatsRow, WeakAreaRow } from './base';

export const usersRepo = {

  // Users

  async getUserByEmail(email: string): Promise<UserRow | null> {
    const { data } = await sb<UserRow[]>(`/users?email=eq.${encodeURIComponent(email)}&select=*`);
    return data?.[0] ?? null;
  },

  async getUserById(id: string): Promise<UserRow | null> {
    const { data } = await sb<UserRow[]>(`/users?id=eq.${encodeURIComponent(id)}&select=*`);
    return data?.[0] ?? null;
  },

  async getUserByReferralCode(code: string): Promise<UserRow | null> {
    const { data } = await sb<UserRow[]>(`/users?referral_code=eq.${encodeURIComponent(code)}&select=*`);
    return data?.[0] ?? null;
  },

  async createUser(input: Omit<UserRow, 'id' | 'created_at' | 'updated_at'>): Promise<UserRow> {
    const { data, ok } = await sb<UserRow[]>('/users', 'POST', input);
    if (!ok || !data?.[0]) throw new AppError(500, 'db_user_creation_failed', 'Failed to create user');
    return data[0];
  },

  async updateUser(id: string, updates: Partial<UserRow>): Promise<void> {
    await sb(`/users?id=eq.${encodeURIComponent(id)}`, 'PATCH', updates);
  },

  async setReferralCode(userId: string, code: string): Promise<void> {
    const { ok } = await sb(`/users?id=eq.${encodeURIComponent(userId)}`, 'PATCH', { referral_code: code });
    if (!ok) throw new AppError(500, 'db_referral_code_failed', 'Failed to set referral code (may be duplicate)');
  },

  async setReferredBy(userId: string, code: string): Promise<void> {
    await sb(`/users?id=eq.${encodeURIComponent(userId)}`, 'PATCH', { referred_by: code });
  },

  /**
   * Atomically credits `amount` bonus sessions to the user's current-month
   * session bonus pool (usage.monthly_session_bonus) via the
   * grant_referral_bonus_sessions RPC (migration 025).
   *
   * Replaces the old addBonusCalls / increment_referral_bonus system which
   * wrote to users.referral_bonus (an AI-call counter). Sessions are the
   * currency users understand; bonus sessions are added to the plan's base
   * monthly cap at enforcement time. No hard-cap param is needed — the
   * monthly reset (lazy, same as monthly_session_count) is the natural ceiling.
   */
  async addBonusSessions(userId: string, amount: number): Promise<void> {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/grant_referral_bonus_sessions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_user_id: userId, p_amount: amount }),
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      throw new AppError(
        500,
        'db_bonus_sessions_failed',
        `grant_referral_bonus_sessions RPC failed (status ${res.status}): ${raw.slice(0, 500)}`
      );
    }
  },

  // Usage

  async getUsage(userId: string): Promise<UsageRow | null> {
    const { data } = await sb<UsageRow[]>(`/usage?user_id=eq.${encodeURIComponent(userId)}&select=*`);
    return data?.[0] ?? null;
  },

  async upsertUsage(userId: string, callCount: number): Promise<void> {
    const existing = await (async () => { const { data } = await sb<UsageRow[]>(`/usage?user_id=eq.${encodeURIComponent(userId)}&select=*`); return data?.[0] ?? null; })();
    if (existing) {
      await sb(`/usage?user_id=eq.${encodeURIComponent(userId)}`, 'PATCH', { call_count: callCount, updated_at: new Date().toISOString() });
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

  /**
   * Atomically checks the monthly session cap AND increments the counter in a
   * single Postgres statement (migration 018, updated RPC signature).
   *
   * The check-then-increment is inside one PL/pgSQL UPDATE so concurrent
   * requests from the same user cannot both pass the cap guard — Postgres
   * serialises row-level locks, eliminating the TOCTOU race that exists when
   * the JS layer reads the count and then calls a separate increment.
   *
   * Returns { new_count, blocked }:
   *   blocked = true  → cap was already reached; caller must 429, do NOT save
   *   blocked = false → increment succeeded; proceed with session save
   *
   * Requires migration 018 (updated):
   *   CREATE OR REPLACE FUNCTION increment_session_count(p_user_id uuid, p_cap integer)
   *   RETURNS TABLE (new_count integer, blocked boolean) LANGUAGE plpgsql ...
   */
  async incrementSessionCount(
    userId: string,
    cap: number,
  ): Promise<{ new_count: number; blocked: boolean }> {
    const { data } = await sb<{ new_count: number; blocked: boolean }[]>(
      '/rpc/increment_session_count',
      'POST',
      { p_user_id: userId, p_cap: cap },
    );
    // Supabase RPC wraps RETURNS TABLE results in an array.
    // If the row is somehow missing (shouldn't happen), treat as not blocked.
    return data?.[0] ?? { new_count: 1, blocked: false };
  },

  async resetUsage(userId: string): Promise<void> {
    // Compute first day of current IST month
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    nowIST.setDate(1);
    nowIST.setHours(0, 0, 0, 0);

    await sb(`/usage?user_id=eq.${encodeURIComponent(userId)}`, 'PATCH', {
      call_count:                      0,
      monthly_session_count:           0,          // P1-A: reset session cap alongside AI-call cap
      monthly_session_reset_at:        nowIST.toISOString(),
      // Migration 025: bonus sessions don't roll over — reset alongside the
      // rest of the usage counters so each month starts fresh.
      monthly_session_bonus:           0,
      monthly_session_bonus_reset_at:  nowIST.toISOString(),
      period_start:                    nowIST.toISOString(),
      updated_at:                      new Date().toISOString(),
    });
  },

  // Stats

  async getStats(userId: string): Promise<StatsRow | null> {
    const { data } = await sb<StatsRow[]>(`/stats?user_id=eq.${encodeURIComponent(userId)}&select=*`);
    return data?.[0] ?? null;
  },

  // Migration 023: XP leaderboard (monthly — profile / all-time ranking)
  async getLeaderboardMonthly(limit = 50): Promise<Array<{
    rank: number;
    display_name: string;
    xp_monthly: number;
    xp_lifetime: number;
    streak: number;
    user_id: string;
  }>> {
    const { data } = await sb<Array<{
      rank: number;
      display_name: string;
      xp_monthly: number;
      xp_lifetime: number;
      streak: number;
      user_id: string;
    }>>(`/leaderboard_monthly?select=*&limit=${limit}`);
    return data ?? [];
  },

  // Migration 024: weekly leaderboard (Pro + Elite only)
  async getLeaderboard(limit = 50): Promise<Array<{
    rank: number;
    display_name: string;
    xp_weekly: number;
    xp_lifetime: number;
    streak: number;
    user_id: string;
  }>> {
    const { data } = await sb<Array<{
      rank: number;
      display_name: string;
      xp_weekly: number;
      xp_lifetime: number;
      streak: number;
      user_id: string;
    }>>(`/leaderboard_weekly?select=*&limit=${limit}`);
    return data ?? [];
  },

  async resetMonthlyXp(): Promise<void> {
    await sb('/rpc/reset_monthly_xp', 'POST', {});
  },

  // Migration 024: reset weekly XP (called lazily post-Sunday midnight IST)
  async resetWeeklyXp(): Promise<void> {
    await sb('/rpc/reset_weekly_xp', 'POST', {});
  },

  /**
   * Atomically increments user stats with ALL arithmetic inside Postgres.
   *
   * Previous version still did read → compute → write in JS, meaning two
   * concurrent saves could race on the read and produce the same base values
   * before either write landed.  This version eliminates the JS read entirely:
   * the SQL function receives only the *delta* for this session and Postgres
   * applies it with a row-level lock held for the duration of the upsert.
   *
   * Streak logic lives in SQL too: if last_session was today → keep current
   * streak; if yesterday → +1; otherwise → reset to 1. "Today"/"yesterday"
   * are computed in IST (Asia/Kolkata), not server UTC — see migrations/
   * 009_streak_timezone_ist.sql for why (L17 audit fix: UTC-day comparison
   * could reset a streak for a late-night IST session that was still the
   * same calendar day for the user).
   *
   * Requires this function in Supabase SQL (see MIGRATION.sql, as amended
   * by migrations/009_streak_timezone_ist.sql — that file is the current
   * source of truth for this function's body):
   *   CREATE OR REPLACE FUNCTION increment_user_stats(
   *     p_user_id        uuid,
   *     p_score          numeric,
   *     p_job_ready      numeric,
   *     p_total_score    numeric
   *   ) RETURNS jsonb LANGUAGE plpgsql AS $$
   *   DECLARE
   *     v_today     date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
   *     v_yesterday date := v_today - 1;
   *     v_last      date;
   *     v_streak    int;
   *     v_row       stats%ROWTYPE;
   *   BEGIN
   *     -- Lock the row for this user (or create it) before reading
   *     INSERT INTO stats (user_id, sessions, best_score, total_score,
   *                        avg_job_ready_score, total_sessions_with_score,
   *                        streak, last_session, updated_at)
   *     VALUES (p_user_id, 0, 0, 0, 0, 0, 0, null, now())
   *     ON CONFLICT (user_id) DO NOTHING;
   *
   *     SELECT * INTO v_row FROM stats WHERE user_id = p_user_id FOR UPDATE;
   *
   *     v_last   := (v_row.last_session AT TIME ZONE 'Asia/Kolkata')::date;
   *     v_streak := CASE
   *       WHEN v_last = v_today     THEN v_row.streak
   *       WHEN v_last = v_yesterday THEN v_row.streak + 1
   *       ELSE 1
   *     END;
   *
   *     UPDATE stats SET
   *       sessions                  = v_row.sessions + 1,
   *       best_score                = GREATEST(v_row.best_score, p_score),
   *       total_score               = v_row.total_score + p_total_score,
   *       avg_job_ready_score       = ROUND(
   *                                     ((v_row.avg_job_ready_score * v_row.total_sessions_with_score)
   *                                      + p_job_ready)
   *                                     / (v_row.total_sessions_with_score + 1), 2),
   *       total_sessions_with_score = v_row.total_sessions_with_score + 1,
   *       streak                    = v_streak,
   *       last_session              = now(),
   *       updated_at                = now()
   *     WHERE user_id = p_user_id;
   *
   *     SELECT * INTO v_row FROM stats WHERE user_id = p_user_id;
   *     RETURN jsonb_build_object(
   *       'sessions',   v_row.sessions,
   *       'best_score', v_row.best_score,
   *       'streak',     v_row.streak,
   *       'avg_job_ready_score', v_row.avg_job_ready_score
   *     );
   *   END;
   *   $$;
   */
  async incrementStats(
    userId:     string,
    score:      number,
    jobReady:   number,
    totalScore: number,
    profession?: string,
    plan?: string,
  ): Promise<{ sessions: number; best_score: number; streak: number; avg_job_ready_score: number; xp_lifetime: number; xp_monthly: number; xp_weekly: number; xp_earned: number; freeze_used: boolean; freezes_remaining: number }> {
    // this used to call `res.json()` directly on the fetch
    // response with no `res.ok` check and no try/catch — unlike every
    // other call in this file, which goes through the `sb()` helper that
    // reads the body as text first and guards the JSON.parse. If Supabase
    // is down, rate-limiting, or returns an HTML/plaintext error page
    // (non-2xx with a non-JSON body), `res.json()` throws, and that throw
    // was unguarded here, propagating straight out of `_saveSession` in
    // sessions.service.ts. The session row and feedback rows may have
    // already been written successfully by that point — the user would
    // still get a 500 with no usable stats in the response.
    let res: Response;
    try {
      res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/increment_user_stats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // previously sent `apikey: anon` here alongside a service-role
          // bearer token — PostgREST resolves the role from the Authorization
          // JWT, so that combination still ran as service_role and bypassed
          // RLS exactly like every other call in this file. Using the same
          // key in both headers removes the misleading appearance of partial
          // RLS enforcement; see the file-level comment for why this client
          // doesn't attempt per-user RLS at all.
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          p_user_id:     userId,
          p_score:       score,
          p_job_ready:   jobReady,
          p_total_score: totalScore,
          p_profession:  profession ?? 'General',
          p_plan:        plan ?? 'free',
        }),
      });
    } catch (err) {
      throw new AppError(
        500, 'stats_increment_network_failed',
        `Failed to reach Supabase for increment_user_stats: ${(err as Error).message}`
      );
    }

    const raw = await res.text();
    if (!res.ok) {
      throw new AppError(
        500, 'stats_increment_failed',
        `increment_user_stats RPC failed (status ${res.status}): ${raw.slice(0, 500)}`
      );
    }

    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      throw new AppError(
        500, 'stats_increment_invalid_response',
        `increment_user_stats returned non-JSON body: ${raw.slice(0, 500)}`
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new AppError(
        500, 'stats_increment_empty_response',
        'increment_user_stats returned an empty/invalid result'
      );
    }

    return parsed as { sessions: number; best_score: number; streak: number; avg_job_ready_score: number; xp_lifetime: number; xp_monthly: number; xp_weekly: number; xp_earned: number; freeze_used: boolean; freezes_remaining: number };
  },

  /** @deprecated — use incrementStats. Kept for admin/backfill paths only. */
  async upsertStats(userId: string, updates: Partial<StatsRow>): Promise<void> {
    const existing = await (async () => { const { data } = await sb<StatsRow[]>(`/stats?user_id=eq.${encodeURIComponent(userId)}&select=*`); return data?.[0] ?? null; })();
    if (existing) {
      await sb(`/stats?user_id=eq.${encodeURIComponent(userId)}`, 'PATCH', { ...updates, updated_at: new Date().toISOString() });
    } else {
      await sb('/stats', 'POST', { user_id: userId, ...updates });
    }
  },

  
};

