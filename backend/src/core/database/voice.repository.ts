import { AppError } from '../utils/errors';
import { env } from '../config/env';
import { sb } from './base';
import type { VoiceUsageLedgerRow, ReadinessReportRow, ScoreComparisonRow, ComparisonResponseRow } from './base';

export const voiceRepo = {

  // Voice usage ledger (migration 011)
  //
  // Tracks TTS and avatar seconds consumed per user per billing cycle.
  // All arithmetic is done inside Postgres RPCs to avoid read-then-write
  // races — same pattern as increment_referral_bonus / increment_user_stats.

  /**
   * Fetch the current IST billing month's ledger row for a user.
   * Returns null if the user has not made any voice calls this month.
   * Used by the gate-checking middleware to read remaining quota.
   */
  async getVoiceUsage(userId: string): Promise<VoiceUsageLedgerRow | null> {
    // billing_month is always the first day of the current IST month.
    // We derive it in JS the same way the SQL helper does so the filter
    // matches without a round-trip to call voice_current_ist_month().
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // shift to IST
    const billingMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const { data } = await sb<VoiceUsageLedgerRow[]>(
      `/voice_usage_ledger?user_id=eq.${encodeURIComponent(userId)}&billing_month=eq.${billingMonth}&select=*`
    );
    return data?.[0] ?? null;
  },

  /**
   * Atomically debits seconds from the ledger after a successful
   * TTS or avatar call. Creates the month's row if it doesn't exist yet.
   * Returns the updated row so the caller can surface remaining quota.
   *
   * Called by voice.controller.ts after streaming succeeds — not before —
   * so a failed upstream call never burns the user's quota.
   */
  async incrementVoiceUsage(
    userId:        string,
    voiceSecs:     number,
    avatarSecs:    number,
  ): Promise<{ voice_seconds_used: number; avatar_seconds_used: number; bonus_voice_seconds: number }> {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/increment_voice_usage`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        p_user_id:        userId,
        p_voice_seconds:  voiceSecs,
        p_avatar_seconds: avatarSecs,
      }),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      throw new AppError(500, 'db_voice_usage_increment_failed',
        `increment_voice_usage RPC failed (status ${res.status}): ${raw.slice(0, 500)}`);
    }
    return res.json() as Promise<{ voice_seconds_used: number; avatar_seconds_used: number; bonus_voice_seconds: number }>;
  },

  /**
   * Credits bonus voice seconds to the ledger for a streak milestone reward.
   * Uses LEAST(current + amount, p_max_bonus) inside the RPC to cap the
   * total — prevents a fabricated streak event from granting unlimited voice.
   *
   * Called by the streak-milestone reward hook in sessions.service.ts,
   * non-fatal by design (same as maybeRewardReferrer).
   */
  async topUpBonusVoiceSeconds(
    userId:    string,
    seconds:   number,
    maxBonus:  number,
  ): Promise<{ bonus_voice_seconds: number }> {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/top_up_bonus_voice_seconds`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        p_user_id:   userId,
        p_seconds:   seconds,
        p_max_bonus: maxBonus,
      }),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      throw new AppError(500, 'db_voice_topup_failed',
        `top_up_bonus_voice_seconds RPC failed (status ${res.status}): ${raw.slice(0, 500)}`);
    }
    return res.json() as Promise<{ bonus_voice_seconds: number }>;
  },

  // Readiness Report

  /**
   * Inserts a new readiness-report checkpoint. ON CONFLICT (user_id,
   * session_count) DO NOTHING makes this idempotent — a queue retry of
   * generate-readiness-report after a partial failure (e.g. the AI call
   * succeeded but the worker crashed before returning) can never create
   * a duplicate row for the same checkpoint. Returns the existing row's
   * id silently lost on conflict; callers don't need it back since the
   * report is read separately via getLatestReadinessReport.
   */
  async createReadinessReport(row: {
    user_id:       string;
    session_count: number;
    report_text:   string;
    avg_score:     number | null;
  }): Promise<void> {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/readiness_reports?on_conflict=user_id,session_count`,
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Prefer':        'resolution=ignore-duplicates',
        },
        body: JSON.stringify(row),
      }
    );
    // 2xx and 409 (duplicate — ON CONFLICT DO NOTHING) are both success states.
    // Any other non-ok response means the row was not written — throw so
    // generateReadinessReport's try/catch logs it rather than silently
    // treating a failed insert as a success (same pattern as createFeedback).
    if (!res.ok && res.status !== 409) {
      const body = await res.text().catch(() => '');
      throw new AppError(
        500, 'db_readiness_report_failed',
        `readiness_reports insert failed (HTTP ${res.status}): ${body.slice(0, 300)}`
      );
    }
  },

  /** Most recent readiness report for a user, or null if none generated yet. */
  async getLatestReadinessReport(userId: string): Promise<ReadinessReportRow | null> {
    const { data } = await sb<ReadinessReportRow[]>(
      `/readiness_reports?user_id=eq.${encodeURIComponent(userId)}&order=session_count.desc&limit=1&select=*`
    );
    return data?.[0] ?? null;
  },

  /** Full history of readiness-report checkpoints for a user, newest first. */
  async getReadinessReportHistory(userId: string): Promise<ReadinessReportRow[]> {
    const { data } = await sb<ReadinessReportRow[]>(
      `/readiness_reports?user_id=eq.${encodeURIComponent(userId)}&order=session_count.desc&select=*`
    );
    return data ?? [];
  },

  // ── Score Comparisons ─────────────────────────────────────

  /** Creates a new comparison challenge row. share_token is the HMAC-signed
   *  public identifier, generated by the service layer before this call. */
  async createScoreComparison(row: Omit<ScoreComparisonRow, 'created_at' | 'expires_at'>): Promise<ScoreComparisonRow> {
    const { data, ok, status } = await sb<ScoreComparisonRow[]>(
      '/score_comparisons',
      'POST',
      row
    );
    if (!ok || !data?.[0]) {
      throw new AppError(500, 'db_comparison_create_failed',
        `score_comparisons insert failed (HTTP ${status})`);
    }
    return data[0];
  },

  /** Fetches a comparison by its public share token. Returns null if not
   *  found or if the comparison has expired. */
  async getScoreComparisonByToken(token: string): Promise<ScoreComparisonRow | null> {
    const { data } = await sb<ScoreComparisonRow[]>(
      `/score_comparisons?share_token=eq.${encodeURIComponent(token)}&select=*`
    );
    const row = data?.[0];
    if (!row) return null;
    // Enforce expiry in application code so the query stays simple
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
    return row;
  },

  /** Fetches all responses for a comparison (for the public leaderboard view). */
  async getComparisonResponses(comparisonId: string): Promise<ComparisonResponseRow[]> {
    const { data } = await sb<ComparisonResponseRow[]>(
      `/comparison_responses?comparison_id=eq.${encodeURIComponent(comparisonId)}&order=created_at.asc&select=*`
    );
    return data ?? [];
  },

  /** Records a challenger's response + AI feedback for a comparison. */
  async createComparisonResponse(
    row: Omit<ComparisonResponseRow, 'id' | 'created_at'>
  ): Promise<ComparisonResponseRow> {
    const { data, ok, status } = await sb<ComparisonResponseRow[]>(
      '/comparison_responses',
      'POST',
      row
    );
    if (!ok || !data?.[0]) {
      throw new AppError(500, 'db_comparison_response_failed',
        `comparison_responses insert failed (HTTP ${status})`);
    }
    return data[0];
  },

  
};

