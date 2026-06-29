/**
 * Weak Area Detection Service
 *
 * Tracks per-user topic-level score averages across all sessions and
 * surfaces them in three ways:
 *
 *   1. Dashboard panel  — /api/me → weak_areas  (UI display)
 *   2. AI prompt        — getWeakAreaPromptContext()  (Aria focuses on weak topics)
 *   3. Drill prompts    — drill_prompt field on each WeakAreaEntry
 *
 * A topic is "weak" when avg_score < 6 / 10 across all sessions in that
 * category. The threshold was chosen to distinguish genuine skill gaps from
 * ordinary variance on a first or second attempt.
 *
 * Triggered after every session save via the queue dispatcher.
 */

import { db } from '../../../core/database/client';
import { aiLogger } from '../../../infra/logger';
import { wrapUntrusted, UNTRUSTED_DATA_INSTRUCTION } from '../../../core/utils';

// Public types
export interface WeakAreaEntry {
  topic:          string;
  avg_score:      number;
  session_count:  number;
  last_practiced: string | null;
  /** UI-facing severity bucket based on avg_score thresholds. */
  severity:       'critical' | 'needs_work' | 'improving';
  /** Pre-built coaching prompt for the dashboard's "drill this" CTA. */
  drill_prompt:   string;
}

// Recompute after every session
/**
 * Aggregates all of a user's sessions into per-topic score averages and
 * upserts the result into the weak_areas table.
 *
 * Safe to call on every session save — the upsert is idempotent and
 * overwrites the previous aggregate. Non-fatal: any DB failure is logged
 * and swallowed so a weak-area write error never bubbles up to the session
 * save response.
 */
export async function recomputeWeakAreas(userId: string): Promise<void> {
  try {
    const sessions = await db.getUserSessionsForWeakAreas(userId);
    if (!sessions || sessions.length === 0) return;

    // Group sessions by normalised topic name (interview_type takes priority
    // over profession, since a "Software Developer" doing a "DSA" session
    // should file under "DSA", not "Software Developer").
    const topicMap: Record<string, { total: number; count: number; last: string }> = {};

    for (const s of sessions) {
      const topic = normalizeTopicName(s.interview_type || s.profession || 'General');
      if (!topicMap[topic]) {
        topicMap[topic] = { total: 0, count: 0, last: s.created_at };
      }
      topicMap[topic].total += s.score || 0;
      topicMap[topic].count += 1;
      if (new Date(s.created_at) > new Date(topicMap[topic].last)) {
        topicMap[topic].last = s.created_at;
      }
    }

    const updates = Object.entries(topicMap).map(([topic, data]) => ({
      user_id:        userId,
      topic,
      avg_score:      Math.round((data.total / data.count) * 100) / 100,
      session_count:  data.count,
      last_practiced: data.last,
      updated_at:     new Date().toISOString(),
    }));

    await db.upsertWeakAreas(userId, updates);
    aiLogger.info('Weak areas recomputed', { userId, topics: updates.length });
  } catch (err) {
    aiLogger.warn('recomputeWeakAreas failed (non-fatal)', { userId, error: err });
  }
}

// Dashboard query
/**
 * Returns the user's weak areas sorted worst-first (lowest avg_score first),
 * decorated with severity and drill prompts for the dashboard UI.
 */
export async function getWeakAreasForUser(userId: string): Promise<WeakAreaEntry[]> {
  try {
    const rows = await db.getWeakAreas(userId);
    if (!rows || rows.length === 0) return [];

    return rows
      .map(row => ({
        topic:          row.topic,
        avg_score:      row.avg_score,
        session_count:  row.session_count,
        last_practiced: row.last_practiced,
        severity:       getSeverity(row.avg_score),
        drill_prompt:   getDrillPrompt(row.topic, row.avg_score),
      }))
      .sort((a, b) => a.avg_score - b.avg_score);
  } catch (err) {
    aiLogger.warn('getWeakAreasForUser failed', { userId, error: err });
    return [];
  }
}

// AI prompt injection
/**
 * Builds a prompt fragment that directs Aria to focus on the user's weak
 * topics and give more detailed feedback when those topics appear.
 *
 * Topic names are wrapped with wrapUntrusted() to prevent prompt injection
 * from user-controlled data stored in the weak_areas table.
 *
 * Returns an empty string when Redis / DB is unavailable (non-fatal).
 */
export async function getWeakAreaPromptContext(userId: string): Promise<string> {
  try {
    const rows = await db.getWeakAreas(userId);
    if (!rows || rows.length === 0) return '';

    const weak = rows.filter(r => r.avg_score < 6);
    if (weak.length === 0) return '';

    const list = weak
      .sort((a, b) => a.avg_score - b.avg_score)
      .slice(0, 3)
      .map(r => `${wrapUntrusted(r.topic)} (avg ${r.avg_score}/10)`)
      .join(', ');

    return (
      `\n\n⚠️ WEAK AREAS: This user consistently underperforms in: ${list}. ` +
      `Ask questions from these areas and give more detailed feedback for them. ` +
      UNTRUSTED_DATA_INSTRUCTION
    );
  } catch {
    return '';
  }
}

// Helpers
function getSeverity(score: number): 'critical' | 'needs_work' | 'improving' {
  if (score < 4) return 'critical';
  if (score < 6) return 'needs_work';
  return 'improving';
}

function getDrillPrompt(topic: string, score: number): string {
  const base = `Practice ${topic} questions`;
  if (score < 4) return `${base} — start with basic concepts, you're struggling here`;
  if (score < 6) return `${base} — focus on structure and concrete examples`;
  return `${base} — you're improving, keep going`;
}

/**
 * Normalises raw session metadata strings to canonical display names.
 *
 * interview_type values come from the client and may vary in casing; we
 * unify them here so "technical" and "Technical" don't create two separate
 * weak-area rows for the same topic.
 */
function normalizeTopicName(raw: string): string {
  const map: Record<string, string> = {
    'technical':     'Technical',
    'behavioral':    'Behavioral / HR',
    'hr':            'Behavioral / HR',
    'mixed':         'Mixed',
    'system design': 'System Design',
    'dsa':           'DSA',
    'case study':    'Case Study',
    'leadership':    'Leadership',
  };
  const lower = raw.toLowerCase().trim();
  return map[lower] || raw.charAt(0).toUpperCase() + raw.slice(1);
}
