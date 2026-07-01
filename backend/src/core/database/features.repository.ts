import { AppError } from '../utils/errors';
import { env } from '../config/env';
import { sb } from './base';
import type { PushSubscriptionRow, DeviceTokenRow, PrepPathRow, UserPrepEnrollmentRow, ElaraSessionRow, ElaraVocabWordRow, UserRow } from './base';

export const featuresRepo = {

  // ── Push subscriptions (migration 015) ────────────────────────────────

  /** Inserts or ignores a push subscription (ON CONFLICT DO NOTHING on endpoint). */
  async upsertPushSubscription(row: Omit<PushSubscriptionRow, 'id' | 'created_at'>): Promise<void> {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/push_subscriptions`, {
      method:  'POST',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=ignore-duplicates',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok && res.status !== 409) {
      throw new AppError(500, 'db_push_subscription_failed', `push_subscriptions upsert failed (HTTP ${res.status})`);
    }
  },

  /** Returns all push subscriptions for a user (fan-out across devices). */
  async getPushSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
    const { data } = await sb<PushSubscriptionRow[]>(
      `/push_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=endpoint,p256dh,auth`
    );
    return data ?? [];
  },

  /** Removes a push subscription by endpoint (used when 410/404 received from push service). */
  async deletePushSubscription(endpoint: string): Promise<void> {
    await fetch(`${env.SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
      method:  'DELETE',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    });
  },

  /** Removes a push subscription by endpoint, scoped to a specific user (used by unsubscribe endpoint). */
  async deletePushSubscriptionForUser(endpoint: string, userId: string): Promise<void> {
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&user_id=eq.${encodeURIComponent(userId)}`,
      {
        method:  'DELETE',
        headers: {
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );
  },

  // ── Device tokens / FCM (migration 031) ─────────────────────────────────
  // Storage only — see push.service.ts for the send-side TODO this unblocks.

  /**
   * Inserts or updates a device token, keyed by the token itself rather than
   * (user_id, token) — the same physical device can re-register under a
   * different account after a logout/login, and the row should follow the
   * device, not accumulate stale rows per account.
   */
  async upsertDeviceToken(row: Omit<DeviceTokenRow, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/device_tokens?on_conflict=token`, {
      method:  'POST',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates',
      },
      body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) {
      throw new AppError(500, 'db_device_token_failed', `device_tokens upsert failed (HTTP ${res.status})`);
    }
  },

  /** Returns all device tokens for a user — the fan-out list for a future FCM send helper. */
  async getDeviceTokensForUser(userId: string): Promise<DeviceTokenRow[]> {
    const { data } = await sb<DeviceTokenRow[]>(
      `/device_tokens?user_id=eq.${encodeURIComponent(userId)}&select=token,platform`
    );
    return data ?? [];
  },

  /** Removes a device token, scoped to the user that registered it (used on logout / unregister). */
  async deleteDeviceToken(token: string, userId: string): Promise<void> {
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/device_tokens?token=eq.${encodeURIComponent(token)}&user_id=eq.${encodeURIComponent(userId)}`,
      {
        method:  'DELETE',
        headers: {
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );
  },

  /** Removes a device token regardless of owner (used when FCM reports it as stale/unregistered). */
  async deleteDeviceTokenAnyUser(token: string): Promise<void> {
    await fetch(`${env.SUPABASE_URL}/rest/v1/device_tokens?token=eq.${encodeURIComponent(token)}`, {
      method:  'DELETE',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    });
  },

  // ── Guided Prep Paths (migration 017, P6-A) ────────────────────────────

  /** Returns all active prep paths (catalog), e.g. for a "browse paths" listing. */
  async getActivePrepPaths(): Promise<PrepPathRow[]> {
    const { data } = await sb<PrepPathRow[]>('/prep_paths?is_active=eq.true&select=*&order=duration_days.asc');
    return data ?? [];
  },

  async getPrepPathById(id: string): Promise<PrepPathRow | null> {
    const { data } = await sb<PrepPathRow[]>(`/prep_paths?id=eq.${encodeURIComponent(id)}&select=*`);
    return data?.[0] ?? null;
  },

  /**
   * Returns the user's most recent *open* (not-yet-completed) enrollment,
   * or null if they have none. A user may have multiple historical
   * enrollments (retakes), so this always orders by enrolled_at desc and
   * takes the first — see migration 017's header comment for why this is
   * enforced in application code rather than a DB uniqueness constraint.
   */
  async getActivePrepEnrollment(userId: string): Promise<UserPrepEnrollmentRow | null> {
    const { data } = await sb<UserPrepEnrollmentRow[]>(
      `/user_prep_enrollments?user_id=eq.${encodeURIComponent(userId)}&completed_at=is.null&select=*&order=enrolled_at.desc&limit=1`
    );
    return data?.[0] ?? null;
  },

  async createPrepEnrollment(userId: string, prepPathId: string): Promise<UserPrepEnrollmentRow> {
    const { data, ok, status } = await sb<UserPrepEnrollmentRow[]>('/user_prep_enrollments', 'POST', {
      user_id:      userId,
      prep_path_id: prepPathId,
    });
    if (!ok || !data?.[0]) {
      throw new AppError(500, 'db_prep_enrollment_failed', `user_prep_enrollments insert failed (HTTP ${status})`);
    }
    return data[0];
  },

  /** Marks an enrollment as completed (used once the user finishes the path's final day). */
  async completePrepEnrollment(enrollmentId: string): Promise<void> {
    await sb(`/user_prep_enrollments?id=eq.${encodeURIComponent(enrollmentId)}`, 'PATCH', {
      completed_at: new Date().toISOString(),
    });
  },

  // ── Migration 019: Free TTS quota + HD voice preference ───────────────────

  /** IST billing month helper — 'YYYY-MM-DD' of the first day of the current IST month. */
  _istBillingMonth(): string {
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // shift to IST
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  },

  /** Returns chars consumed by a free user this IST billing month (0 if no row). */
  async getFreeTtsCharsUsed(userId: string): Promise<number> {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_free_tts_chars_used`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_user_id: userId }),
    });
    if (!res.ok) return 0; // fail-open: let the TTS call proceed
    const val = await res.json() as number | null;
    return val ?? 0;
  },

  /** Atomically increments free TTS char usage. Fire-and-forget (non-fatal on error). */
  async incrementFreeTtsChars(userId: string, chars: number): Promise<number> {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/increment_free_tts_chars`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_user_id: userId, p_chars: chars }),
    });
    if (!res.ok) return chars; // fail-open
    const val = await res.json() as number | null;
    return val ?? chars;
  },

  /** Reads the hd_voice_enabled preference for a user. Defaults false on error. */
  async getHdVoiceEnabled(userId: string): Promise<boolean> {
    const { data } = await sb<UserRow[]>(`/users?id=eq.${encodeURIComponent(userId)}&select=*`);
    return data?.[0]?.hd_voice_enabled ?? false;
  },

  /** Persists the HD voice toggle for a user. */
  async setHdVoiceEnabled(userId: string, enabled: boolean): Promise<void> {
    await sb(`/users?id=eq.${encodeURIComponent(userId)}`, 'PATCH', {
      hd_voice_enabled: enabled,
    });
  },

  // ── Elara Sessions ────────────────────────────────────────────────────────

  /**
   * Saves a completed Elara English conversation session.
   * Idempotent via (user_id, client_session_id) unique constraint — a client
   * retry with the same client_session_id is a no-op (ON CONFLICT DO NOTHING).
   */
  async saveElaraSession(input: Omit<ElaraSessionRow, 'id' | 'created_at'>): Promise<void> {
    await sb('/elara_sessions', 'POST', input, {
      extraHeaders: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    });
  },

  /**
   * Returns elara sessions for a user ordered newest-first.
   * Used to build the "English Journey" week-over-week chart.
   */
  async getElaraSessions(userId: string, limit: number): Promise<ElaraSessionRow[]> {
    const { data } = await sb<ElaraSessionRow[]>(
      `/elara_sessions?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}&select=*`
    );
    return data ?? [];
  },

  // ── Elara Vocabulary Words ────────────────────────────────────────────────

  /**
   * Upserts a vocab word for a user.
   * On conflict (user_id, wrong_form): increments occurrences and updates
   * correct_form/rule in case Elara refines the suggestion. Sets auto_saved
   * when occurrences reach the 3-strike threshold (done in service layer).
   */
  async upsertVocabWord(input: {
    user_id:       string;
    wrong_form:    string;
    correct_form:  string;
    rule?:         string | null;
    auto_saved?:   boolean;
    manually_saved?: boolean;
  }): Promise<ElaraVocabWordRow | null> {
    // PostgREST upsert: merge-duplicates updates the conflicting row.
    const { data } = await sb<ElaraVocabWordRow[]>(
      '/elara_vocab_words',
      'POST',
      {
        user_id:        input.user_id,
        wrong_form:     input.wrong_form,
        correct_form:   input.correct_form,
        rule:           input.rule ?? null,
        auto_saved:     input.auto_saved  ?? false,
        manually_saved: input.manually_saved ?? false,
        occurrences:    1,   // INSERT value; ON CONFLICT path uses increment_vocab_occurrence RPC
        updated_at:     new Date().toISOString(),
      },
      {
        extraHeaders: { Prefer: 'resolution=merge-duplicates,return=representation' },
      }
    );
    return data?.[0] ?? null;
  },

  /**
   * Increments occurrence count for a (user, wrong_form) pair.
   * Called every time Elara flags the same error again. Returns updated row.
   */
  async incrementVocabOccurrence(
    userId: string,
    wrongForm: string,
  ): Promise<ElaraVocabWordRow | null> {
    const { data } = await sb<ElaraVocabWordRow[]>(
      `/elara_vocab_words?user_id=eq.${encodeURIComponent(userId)}&wrong_form=eq.${encodeURIComponent(wrongForm)}`,
      'PATCH',
      {
        occurrences: 'occurrences + 1',   // Raw SQL via PostgREST arithmetic expression
        updated_at:  new Date().toISOString(),
      },
      { extraHeaders: { Prefer: 'return=representation' } }
    );
    return data?.[0] ?? null;
  },

  /**
   * Marks a word as auto_saved=true once it crosses the 3-strike threshold.
   */
  async markVocabAutoSaved(userId: string, wrongForm: string): Promise<void> {
    await sb(
      `/elara_vocab_words?user_id=eq.${encodeURIComponent(userId)}&wrong_form=eq.${encodeURIComponent(wrongForm)}`,
      'PATCH',
      { auto_saved: true, updated_at: new Date().toISOString() },
    );
  },

  /**
   * Marks a word as manually_saved=true (user tapped it in the UI).
   */
  async markVocabManuallySaved(userId: string, wrongForm: string): Promise<void> {
    await sb(
      `/elara_vocab_words?user_id=eq.${encodeURIComponent(userId)}&wrong_form=eq.${encodeURIComponent(wrongForm)}`,
      'PATCH',
      { manually_saved: true, updated_at: new Date().toISOString() },
    );
  },

  /**
   * Returns a single vocab word entry for (user, wrong_form). Returns null
   * if the word hasn't been tracked yet for this user.
   */
  async getVocabWordByWrongForm(
    userId:    string,
    wrongForm: string,
  ): Promise<ElaraVocabWordRow | null> {
    const { data } = await sb<ElaraVocabWordRow[]>(
      `/elara_vocab_words?user_id=eq.${encodeURIComponent(userId)}&wrong_form=eq.${encodeURIComponent(wrongForm)}&select=*&limit=1`
    );
    return data?.[0] ?? null;
  },

  /**
   * Sets occurrences to an explicit value (computed in the service layer
   * to avoid a raw-expression PATCH which PostgREST v9 does not support).
   */
  async patchVocabOccurrences(
    userId:     string,
    wrongForm:  string,
    newCount:   number,
  ): Promise<void> {
    await sb(
      `/elara_vocab_words?user_id=eq.${encodeURIComponent(userId)}&wrong_form=eq.${encodeURIComponent(wrongForm)}`,
      'PATCH',
      { occurrences: newCount, updated_at: new Date().toISOString() },
    );
  },

  /**
   * Returns all saved vocab words for a user (auto or manual), newest first.
   * Used for the dashboard vocab list and the /english page sidebar.
   */
  async getVocabWords(userId: string): Promise<ElaraVocabWordRow[]> {
    const { data } = await sb<ElaraVocabWordRow[]>(
      `/elara_vocab_words?user_id=eq.${encodeURIComponent(userId)}&or=(auto_saved.eq.true,manually_saved.eq.true)&order=occurrences.desc,updated_at.desc&select=*`
    );
    return data ?? [];
  },

  /**
   * Returns the top N weakest words (highest occurrence, not yet reinforced
   * recently). Used to inject into the Elara system prompt.
   */
  async getTopWeakVocabWords(userId: string, limit = 10): Promise<ElaraVocabWordRow[]> {
    const { data } = await sb<ElaraVocabWordRow[]>(
      `/elara_vocab_words?user_id=eq.${encodeURIComponent(userId)}&or=(auto_saved.eq.true,manually_saved.eq.true)&order=occurrences.desc,updated_at.desc&limit=${limit}&select=*`
    );
    return data ?? [];
  },

  /**
   * Stamps last_reinforced_at for a set of words after injecting them into
   * the Elara system prompt, so the scheduler can rotate words over time.
   */
  async stampVocabReinforced(userId: string, wrongForms: string[]): Promise<void> {
    if (!wrongForms.length) return;
    const inClause = wrongForms.map(w => encodeURIComponent(w)).join(',');
    await sb(
      `/elara_vocab_words?user_id=eq.${encodeURIComponent(userId)}&wrong_form=in.(${inClause})`,
      'PATCH',
      { last_reinforced_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    );
  },

  // ── Milestone rewards (migration 026) ────────────────────────────────────

  /**
   * Records a milestone as granted in users.milestone_rewards_granted (jsonb).
   * Uses a Postgres jsonb merge so concurrent grants of different milestones
   * don't overwrite each other.  Safe to call multiple times for the same
   * milestone — the flag is simply set to true again.
   */
  async grantMilestoneReward(userId: string, milestone: number): Promise<void> {
    // PostgREST doesn't support jsonb || operator directly, so we use the
    // RPC approach: updateUser with the merged object fetched first.
    // For simplicity (and to avoid a round-trip race) we use a raw SQL RPC.
    const url = `${env.SUPABASE_URL}/rest/v1/rpc/grant_milestone_reward`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        apikey:          env.SUPABASE_SERVICE_KEY,
        Authorization:   `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_user_id: userId, p_milestone: String(milestone) }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`grantMilestoneReward RPC failed (${res.status}): ${body.slice(0, 200)}`);
    }
  },

  /**
   * Sets the XP double-day for the 30-day milestone.
   * date_str is an IST calendar date string: 'YYYY-MM-DD'.
   * increment_user_stats checks this column and doubles XP when it matches today (IST).
   */
  async setXpDoubleDay(userId: string, dateStr: string | null): Promise<void> {
    await sb(`/users?id=eq.${encodeURIComponent(userId)}`, 'PATCH', { xp_double_day: dateStr });
  },

  /**
   * Sets elite_trial_expires_at for the 90-day milestone.
   * expiresAt is an ISO-8601 timestamp string (NOW() + 7 days).
   * effective_plan() DB function returns 'elite' until this timestamp passes.
   */
  async setEliteTrial(userId: string, expiresAt: string): Promise<void> {
    await sb(`/users?id=eq.${encodeURIComponent(userId)}`, 'PATCH', { elite_trial_expires_at: expiresAt });
  },

  /**
   * Returns the user's effective plan, respecting an active elite trial.
   * Falls back to users.plan when the trial is absent or expired.
   * Resolves locally without a DB round-trip for common cases.
   */
  getEffectivePlan(user: Pick<UserRow, 'plan' | 'elite_trial_expires_at'>): string {
    if (
      user.elite_trial_expires_at &&
      new Date(user.elite_trial_expires_at) > new Date()
    ) {
      return 'elite';
    }
    return user.plan;
  },

  /**
   * Returns recent speech metrics rows for a user, newest-first.
   * Used by the weekly-card service to compute the fluency trend arrow.
   */
  async getRecentSpeechMetrics(
    userId: string,
    limit = 14,
  ): Promise<Array<{ created_at: string; wpm: number; filler_count: number; answer_count: number }>> {
    const url =
      `${env.SUPABASE_URL}/rest/v1/speech_metrics` +
      `?user_id=eq.${encodeURIComponent(userId)}` +
      `&select=created_at,wpm,filler_count,answer_count` +
      `&order=created_at.desc` +
      `&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        'Content-Type':  'application/json',
        apikey:          env.SUPABASE_SERVICE_KEY,
        Authorization:   `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!res.ok) return [];
    const rows = await res.json() as Array<{ created_at: string; wpm: number; filler_count: number; answer_count: number }>;
    return rows ?? [];
  },

};

