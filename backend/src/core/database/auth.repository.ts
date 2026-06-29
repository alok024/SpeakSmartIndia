import { AppError } from '../utils/errors';
import { env } from '../config/env';
import { sb } from './base';
import type { TokenBlacklistRow, PasswordResetRow, EmailVerificationTokenRow, EmailVerificationSendRow, UsageRow, ReferralEventRow, UserMistakeRow, WeakAreaRow, ScoreHistoryRow } from './base';

export const authRepo = {

  // Password resets

  async createPasswordReset(input: Omit<PasswordResetRow, 'id' | 'used'>): Promise<void> {
    await sb('/password_resets', 'POST', { ...input, used: false });
  },

  async getPasswordReset(token: string): Promise<PasswordResetRow | null> {
    const { data } = await sb<PasswordResetRow[]>(
      `/password_resets?token=eq.${encodeURIComponent(token)}&used=eq.false&select=*`
    );
    return data?.[0] ?? null;
  },

  async markPasswordResetUsed(id: string): Promise<void> {
    await sb(`/password_resets?id=eq.${encodeURIComponent(id)}`, 'PATCH', { used: true });
  },

  async invalidatePasswordResets(userId: string): Promise<void> {
    // Mark all existing unused resets as used before issuing a new one
    // Prevents token accumulation and multiple valid reset links floating around
    await sb(`/password_resets?user_id=eq.${encodeURIComponent(userId)}&used=eq.false`, 'PATCH', { used: true });
  },

  // User mistakes (AI memory)

  async getUserMistakes(userId: string, topic: string): Promise<UserMistakeRow[]> {
    const { data } = await sb<UserMistakeRow[]>(
      `/user_mistakes?user_id=eq.${encodeURIComponent(userId)}&topic=eq.${encodeURIComponent(topic)}&order=occurrences.desc&limit=10&select=*`
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
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/upsert_user_mistake`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify(params),
    });
    // previously discarded — a failed write here just means a weak
    // area / AI-memory mistake was silently never recorded. The caller
    // (ai.memory.ts) already wraps this in Promise.allSettled inside a
    // try/catch, so throwing is safe and lets that non-fatal logging
    // actually have something to log.
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AppError(502, 'db_mistake_upsert_failed', `upsert_user_mistake RPC failed (HTTP ${res.status}): ${body.slice(0, 500)}`);
    }
  },

  // Weak areas

  async getWeakAreas(userId: string): Promise<WeakAreaRow[]> {
    const { data } = await sb<WeakAreaRow[]>(
      `/weak_areas?user_id=eq.${encodeURIComponent(userId)}&order=avg_score.asc&select=*`
    );
    return data ?? [];
  },

  /**
   * Upsert weak areas per-row using ON CONFLICT DO UPDATE.
   * The previous implementation did DELETE then INSERT in two separate
   * requests — any concurrent read between them returned an empty array,
   * and a server crash between the two left the user with no weak area data.
   *
   * Requires this unique constraint:
   *   ALTER TABLE weak_areas ADD CONSTRAINT weak_areas_user_topic_unique
   *     UNIQUE (user_id, topic);
   *
   * PostgREST maps `Prefer: resolution=merge-duplicates` to
   * ON CONFLICT (user_id, topic) DO UPDATE SET ... which is atomic per-row.
   */
  async upsertWeakAreas(userId: string, entries: WeakAreaRow[]): Promise<void> {
    if (entries.length === 0) return;
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/weak_areas?on_conflict=user_id,topic`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         env.SUPABASE_SERVICE_KEY,
        Authorization:  `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        Prefer:         'resolution=merge-duplicates',
      },
      body: JSON.stringify(entries),
    });
    // previously discarded — a failed write here silently means the
    // dashboard's "weak areas" panel (and the AI prompt context derived
    // from it) goes stale with no error anywhere. recomputeWeakAreas()
    // already wraps this call in a non-fatal try/catch, so throwing here
    // is safe and gives that catch something real to log.
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AppError(502, 'db_weak_areas_write_failed', `weak_areas upsert failed (HTTP ${res.status}): ${body.slice(0, 500)}`);
    }
  },

  // Score history

  async addScoreHistory(input: Omit<ScoreHistoryRow, 'id' | 'created_at'>): Promise<void> {
    await sb('/score_history', 'POST', input);
  },

  async getScoreHistory(userId: string, limit: number): Promise<ScoreHistoryRow[]> {
    const { data } = await sb<ScoreHistoryRow[]>(
      `/score_history?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}&select=*`
    );
    return data ?? [];
  },

  // Referral events

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
      `/referral_events?referred_id=eq.${encodeURIComponent(referredId)}&rewarded_at=is.null&select=*&limit=1`
    );
    return data?.[0] ?? null;
  },

  async markReferralRewarded(eventId: string): Promise<void> {
    await sb(`/referral_events?id=eq.${encodeURIComponent(eventId)}`, 'PATCH', { rewarded_at: new Date().toISOString() });
  },

  async getReferralStats(referrerId: string): Promise<{ uses: number; rewarded: number; bonus_sessions: number }> {
    const [eventsRes, usageRes] = await Promise.all([
      sb<ReferralEventRow[]>(`/referral_events?referrer_id=eq.${encodeURIComponent(referrerId)}&select=*`),
      sb<UsageRow[]>(`/usage?user_id=eq.${encodeURIComponent(referrerId)}&select=*`),
    ]);
    const events = eventsRes.data ?? [];
    return {
      uses:          events.length,
      rewarded:      events.filter(e => e.rewarded_at != null).length,
      // Migration 025: bonus is now the current-month session pool, not a
      // lifetime AI-call accumulator (users.referral_bonus). Resets monthly.
      bonus_sessions: usageRes.data?.[0]?.monthly_session_bonus ?? 0,
    };
  },

  // Email verification tokens

  /**
   * Invalidate all currently-unused verification tokens for a user.
   * Called before issuing a new token so only one link is ever valid.
   */
  async invalidateEmailVerificationTokens(userId: string): Promise<void> {
    await sb(`/email_verification_tokens?user_id=eq.${encodeURIComponent(userId)}&used=eq.false`, 'PATCH', { used: true });
  },

  async createEmailVerificationToken(
    input: Omit<EmailVerificationTokenRow, 'id' | 'used' | 'created_at'>
  ): Promise<void> {
    const { ok, data } = await sb('/email_verification_tokens', 'POST', { ...input, used: false });
    if (!ok) throw new AppError(500, 'db_token_insert_failed', `Failed to insert verification token: ${JSON.stringify(data)}`);
  },

  async getEmailVerificationTokenByHash(tokenHash: string): Promise<EmailVerificationTokenRow | null> {
    const { data } = await sb<EmailVerificationTokenRow[]>(
      `/email_verification_tokens?token_hash=eq.${tokenHash}&select=*`
    );
    return data?.[0] ?? null;
  },

  /**
   * Atomically mark a token as used. The `used=eq.false` filter guards
   * against a race where two requests redeem the same token concurrently —
   * only the first one will affect a row.
   */
  async markEmailVerificationTokenUsed(id: string): Promise<boolean> {
    const { ok, data } = await sb<EmailVerificationTokenRow[]>(
      `/email_verification_tokens?id=eq.${encodeURIComponent(id)}&used=eq.false`, 'PATCH', { used: true }
    );
    return ok && !!data?.length;
  },

  // Email verification send log (rate limiting)

  async recordEmailVerificationSend(userId: string): Promise<void> {
    await sb('/email_verification_sends', 'POST', { user_id: userId });
  },

  async countRecentEmailVerificationSends(userId: string, sinceIso: string): Promise<number> {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/email_verification_sends?user_id=eq.${encodeURIComponent(userId)}&sent_at=gte.${sinceIso}&select=id`,
      {
        method:  'GET',
        headers: {
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Prefer':        'count=exact',
        },
      }
    );
    const range = res.headers.get('content-range'); // e.g. "0-2/5"
    const total = range?.split('/')[1];
    return total ? parseInt(total, 10) : 0;
  },

  
};

