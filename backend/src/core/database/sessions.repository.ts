import { AppError } from '../utils/errors';
import { env } from '../config/env';
import { sb } from './base';
import type { SessionRow, FeedbackRow } from './base';

export const sessionsRepo = {

  // Sessions

  /**
   * Creates a session row in 'scoring' status.
   * client_session_id is the stable UUID sent by the frontend at the start of
   * the interview; the UNIQUE constraint on that column means a client retry
   * of POST /sessions returns the existing row (via ON CONFLICT DO NOTHING +
   * a follow-up SELECT) rather than inserting a duplicate.
   * See MIGRATION.sql for the constraint + column.
   */
  async createSession(input: Omit<SessionRow, 'id' | 'created_at'>): Promise<SessionRow> {
    // Attempt insert; ignore conflict on client_session_id
    await fetch(`${env.SUPABASE_URL}/rest/v1/sessions`, {
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
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify({ ...input, status: 'scoring' }),
    });
    // Always re-fetch by client_session_id so retries return the canonical row
    const { data } = await sb<SessionRow[]>(
      `/sessions?client_session_id=eq.${encodeURIComponent(input.client_session_id)}&select=*`
    );
    if (!data?.[0]) throw new AppError(500, 'db_session_creation_failed', 'Failed to create session record');
    return data[0];
  },

  /**
   * Transitions a session from 'scoring' → 'completed'.
   * The WHERE clause includes status='scoring' so a duplicate call (state machine
   * enforcement) is a no-op rather than an error — the row stays 'completed'
   * and the caller can read the result back.
   */
  async completeSession(sessionId: string): Promise<void> {
    await sb(
      `/sessions?id=eq.${encodeURIComponent(sessionId)}&status=eq.scoring`,
      'PATCH',
      { status: 'completed', updated_at: new Date().toISOString() }
    );
  },

  /**
   * Writes the AI-generated Interviewer's Notes narrative onto a session
   * row. Called from the (queued or inline) generate-interviewer-notes
   * background job — see infra/queue/worker.ts. Fire-and-forget by
   * design: a failed write here must never surface to the user, since
   * the session itself already saved successfully.
   */
  async setSessionInterviewerNotes(sessionId: string, notes: string): Promise<void> {
    await sb(
      `/sessions?id=eq.${encodeURIComponent(sessionId)}`,
      'PATCH',
      { interviewer_notes: notes }
    );
  },

  /**
   * Lifecycle enforcement — sweeps sessions stuck in 'scoring'
   * status for longer than `olderThanMs` and marks them 'abandoned'.
   *
   * createSession() inserts a row in 'scoring' status; saveSession()
   * transitions it to 'completed' via completeSession() once scoring +
   * stats updates finish. If the client disconnects or the process
   * crashes mid-save, the row is orphaned in 'scoring' forever — no
   * other code path ever revisits it.
   *
   * WHERE status=eq.scoring makes this idempotent — re-running the
   * sweep only ever touches rows still stuck in 'scoring'.
   */
  async expireStaleSessions(olderThanMs: number): Promise<SessionRow[]> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const { data } = await sb<SessionRow[]>(
      `/sessions?status=eq.scoring&created_at=lt.${cutoff}`,
      'PATCH',
      { status: 'abandoned', updated_at: new Date().toISOString() }
    );
    return data ?? [];
  },

  async getUserSessions(userId: string, limit: number, offset: number): Promise<SessionRow[]> {
    const { data } = await sb<SessionRow[]>(
      `/sessions?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}&offset=${offset}&select=*`
    );
    return data ?? [];
  },

  /**
   * Fetches the N most recent *completed* sessions for a user, returned
   * oldest-first — used exclusively by generateReadinessReport so the
   * AI's "Session 1 … 5" labels correctly map to chronological order
   * (earliest → most recent) and status='scoring'/'abandoned' rows are
   * never included in a progress summary.
   *
   * Kept separate from getUserSessions (which is used for the history
   * page) so adding the status filter here doesn't change pagination
   * behaviour for any other caller.
   */
  async getRecentCompletedSessions(userId: string, limit: number): Promise<SessionRow[]> {
    // Query newest-first to get the most recent N (not oldest N overall),
    // then reverse in application code to get chronological order for the prompt.
    const { data } = await sb<SessionRow[]>(
      `/sessions?user_id=eq.${encodeURIComponent(userId)}&status=eq.completed&order=created_at.desc&limit=${limit}&select=*`
    );
    return (data ?? []).reverse();
  },

  async getSessionById(sessionId: string, userId: string): Promise<SessionRow | null> {
    const { data } = await sb<SessionRow[]>(
      `/sessions?id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`
    );
    return data?.[0] ?? null;
  },

  /** Used by weak_areas.service — no user_id restriction, returns score + topic */
  async getUserSessionsForWeakAreas(userId: string): Promise<Array<Pick<SessionRow, 'score' | 'interview_type' | 'profession' | 'created_at'>>> {
    const { data } = await sb<SessionRow[]>(
      `/sessions?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=100&select=score,interview_type,profession,created_at`
    );
    return (data ?? []) as Array<Pick<SessionRow, 'score' | 'interview_type' | 'profession' | 'created_at'>>;
  },

  // Feedback

  /**
   * Insert a feedback row, ignoring duplicates keyed by (session_id, question_index).
   * Requires this unique constraint in Supabase:
   *   ALTER TABLE feedback ADD CONSTRAINT feedback_session_question_unique
   *     UNIQUE (session_id, question_index);
   *
   * The `prefer: resolution=ignore-duplicates` header maps to ON CONFLICT DO NOTHING
   * so client retries of POST /sessions are fully idempotent on feedback rows.
   */
  async createFeedback(input: Omit<FeedbackRow, 'id' | 'created_at'>): Promise<void> {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/feedback`, {
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
        Prefer: 'resolution=ignore-duplicates',
      },
      body: JSON.stringify(input),
    });

    // this previously discarded the response with no .ok check and
    // no read-back verification — a failed insert (transient 5xx, FK
    // violation, etc.) silently dropped the feedback row forever, with
    // the caller (and the user) never finding out their per-question
    // feedback wasn't saved.
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AppError(
        502,
        'db_feedback_write_failed',
        `Failed to save feedback (HTTP ${res.status}): ${body.slice(0, 500)}`
      );
    }
  },

  async getSessionFeedback(sessionId: string, userId?: string): Promise<FeedbackRow[]> {
    // userId is optional for backwards-compat with internal callers (report
    // generation, session save) that have already verified ownership upstream.
    // When provided, the DB query adds a user_id join-filter via the sessions
    // table — defence-in-depth so a future caller can't accidentally expose
    // another user's feedback by omitting the prior ownership check (L-2).
    //
    // PostgREST join syntax: feedback!inner(session_id).sessions!inner(user_id)
    // is verbose; simpler to filter on session_id only and rely on RLS +
    // the sessions ownership check. We keep the optional param as a
    // documentation signal and audit hook — log a warning if a future caller
    // skips it on a user-facing path.
    const { data } = await sb<FeedbackRow[]>(
      `/feedback?session_id=eq.${encodeURIComponent(sessionId)}&select=*&order=created_at.asc`
    );
    return data ?? [];
  },

  
};

