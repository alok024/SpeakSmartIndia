/**
 * Sessions Service — Phase 3 + Phase 7
 *
 * Phase 7 change: steps 5 & 6 (AI memory + weak areas) now go
 * through the queue dispatcher instead of inline fire-and-forget.
 *
 * With Redis:    → queued, retried up to 3× on failure
 * Without Redis: → inline fire-and-forget (identical to before)
 *
 * Everything else is unchanged.
 */

import { db }                      from '../../core/database/client';
import { logger }                  from '../../infra/logger';
import { computeScoreBreakdown, FeedbackForScoring } from '../ai/scoring';
import {
  dispatchPersistMistakes,
  dispatchRecomputeWeakAreas,
} from '../../infra/queue/dispatcher';

const log = logger.child({ module: 'sessions' });

// ── Types ─────────────────────────────────────────────────────────

export interface SaveSessionInput {
  userId:         string;
  profession:     string;
  mode:           string;
  difficulty:     string;
  interview_type: string;
  personality:    string;
  score:          number;
  exchanges:      number;
  duration_secs:  number;
  hindi_mode:     boolean;
  feedbacks?:     FeedbackInput[];
}

export interface FeedbackInput {
  q?:              string;
  question?:       string;
  answer?:         string;
  score?:          number;
  english_errors?: string[];
  corrections?:    unknown[];
  tip?:            string;
  tips?:           string;
  structure?:      Record<string, unknown>;
  model_answer?:   Record<string, unknown>;
}

export interface SaveSessionResult {
  session_id:      string;
  streak:          number;
  sessions:        number;
  best_score:      number;
  job_ready_score: number;
  score_breakdown: {
    clarity:   number;
    structure: number;
    relevance: number;
    grammar:   number;
  };
}

// ── Save session ──────────────────────────────────────────────────

export async function saveSession(input: SaveSessionInput): Promise<SaveSessionResult> {
  const {
    userId, profession, mode, difficulty,
    interview_type, personality, score,
    exchanges, duration_secs, hindi_mode, feedbacks,
  } = input;

  // 1. Compute score breakdown
  const feedbacksForScoring: FeedbackForScoring[] = (feedbacks || []).map(f => ({
    score:          f.score,
    english_errors: f.english_errors,
    corrections:    f.corrections as unknown[],
    structure:      f.structure,
    tips:           f.tip || f.tips,
    answer:         f.answer,
  }));

  const breakdown = computeScoreBreakdown(feedbacksForScoring);

  // 2. Save session record
  const session = await db.createSession({
    user_id:         userId,
    profession:      profession     || 'General',
    mode:            mode           || 'classic',
    difficulty:      difficulty     || 'beginner',
    interview_type:  interview_type || 'mixed',
    personality:     personality    || 'friendly',
    score:           score          || 0,
    exchanges:       exchanges      || 0,
    duration_secs:   duration_secs  || 0,
    hindi_mode:      hindi_mode     || false,
    clarity_score:   breakdown.clarity,
    structure_score: breakdown.structure,
    relevance_score: breakdown.relevance,
    grammar_score:   breakdown.grammar,
    job_ready_score: breakdown.jobReady,
  });

  if (!session?.id) throw new Error('Failed to create session record');

  // 3. Save feedback records (non-fatal on individual failures)
  if (feedbacks && feedbacks.length > 0) {
    await Promise.allSettled(
      feedbacks.map(f =>
        db.createFeedback({
          session_id:   session.id!,
          question:     f.q || f.question || '',
          answer:       f.answer         || '',
          score:        f.score          || 0,
          corrections:  JSON.stringify(f.english_errors || f.corrections || []),
          tips:         f.tip || f.tips  || '',
          structure:    JSON.stringify(f.structure    || {}),
          model_answer: JSON.stringify(f.model_answer || {}),
        })
      )
    );
  }

  // 4. Update stats
  const existing = await db.getStats(userId);

  const today     = new Date().toDateString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const lastSession = existing?.last_session
    ? new Date(existing.last_session).toDateString()
    : null;

  const newStreak = lastSession === today
    ? (existing?.streak || 0)
    : lastSession === yesterday.toDateString()
      ? (existing?.streak || 0) + 1
      : 1;

  const newSessions = (existing?.sessions || 0) + 1;
  const newBest     = Math.max(existing?.best_score || 0, score || 0);
  const prevCount   = existing?.total_sessions_with_score || 0;
  const prevAvgJR   = existing?.avg_job_ready_score || 0;
  const newCount    = prevCount + 1;
  const newAvgJR    = Math.round(((prevAvgJR * prevCount) + breakdown.jobReady) / newCount * 100) / 100;

  await db.upsertStats(userId, {
    streak:                    newStreak,
    sessions:                  newSessions,
    best_score:                newBest,
    total_score:               (existing?.total_score || 0) + (score || 0),
    last_session:              new Date().toISOString(),
    avg_job_ready_score:       newAvgJR,
    total_sessions_with_score: newCount,
  });

  // 5. Score history for graph (non-fatal)
  db.addScoreHistory({
    user_id:         userId,
    session_id:      session.id,
    score:           score || 0,
    job_ready_score: breakdown.jobReady,
    topic:           interview_type || profession,
  }).catch(err => log.warn('Score history insert failed (non-fatal)', { error: err }));

  // ── Phase 7: background jobs go through the queue dispatcher ────
  // With Redis    → queued with 3× retry + exponential backoff
  // Without Redis → inline fire-and-forget (dev / degraded mode)

  // 6. AI memory — persist recurring mistakes from this session
  if (feedbacks && feedbacks.length > 0) {
    dispatchPersistMistakes(
      userId,
      interview_type || profession,
      feedbacks as never
    ).catch(() => {/* dispatcher logs internally */});
  }

  // 7. Weak areas — recompute topic scores for the dashboard
  dispatchRecomputeWeakAreas(userId)
    .catch(() => {/* dispatcher logs internally */});

  log.info('Session saved', {
    userId,
    sessionId:     session.id,
    jobReadyScore: breakdown.jobReady,
    streak:        newStreak,
  });

  return {
    session_id:      session.id,
    streak:          newStreak,
    sessions:        newSessions,
    best_score:      newBest,
    job_ready_score: breakdown.jobReady,
    score_breakdown: {
      clarity:   breakdown.clarity,
      structure: breakdown.structure,
      relevance: breakdown.relevance,
      grammar:   breakdown.grammar,
    },
  };
}

// ── List sessions (paginated) ─────────────────────────────────────

export async function listSessions(userId: string, page = 1, pageSize = 10) {
  const offset   = (page - 1) * pageSize;
  const sessions = await db.getUserSessions(userId, pageSize, offset);
  return {
    sessions,
    page,
    page_size: pageSize,
    has_more:  sessions.length === pageSize,
  };
}

// ── Get session detail with parsed feedback ───────────────────────

export async function getSessionDetail(sessionId: string, userId: string) {
  const session = await db.getSessionById(sessionId, userId);
  if (!session) return null;

  const feedbacks = await db.getSessionFeedback(sessionId);

  const parsed = feedbacks.map(f => ({
    ...f,
    corrections:  safeJsonParse(f.corrections, []),
    structure:    safeJsonParse(f.structure,    {}),
    model_answer: safeJsonParse(f.model_answer, {}),
  }));

  return { session, feedbacks: parsed };
}

// ── Score history for chart ───────────────────────────────────────

export async function getScoreHistory(userId: string, limit = 30) {
  const history = await db.getScoreHistory(userId, limit);
  return history.reverse(); // oldest first for charting
}

// ── Helpers ───────────────────────────────────────────────────────

function safeJsonParse<T>(val: unknown, fallback: T): T {
  try {
    return typeof val === 'string' ? JSON.parse(val) : (val as T) ?? fallback;
  } catch {
    return fallback;
  }
}
