/**
 * Weak Area Detection Service
 *
 * Recomputes the user's weak areas after every session.
 * A "weak area" is a topic where avg_score < 6/10.
 *
 * Powers:
 *   - Dashboard "Your weak areas" panel  (/api/me → weak_areas)
 *   - AI prompt injection                (getWeakAreaPromptContext)
 *   - Drill recommendations              (drill_prompt field)
 */

import { db } from '../../core/database/client';
import { aiLogger } from '../../infra/logger';

// ── Recompute after every session save ────────────────────────────

export async function recomputeWeakAreas(userId: string): Promise<void> {
  try {
    const sessions = await db.getUserSessionsForWeakAreas(userId);
    if (!sessions || sessions.length === 0) return;

    // Group by normalised topic
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

// ── Get weak areas for /api/me response ───────────────────────────

export interface WeakAreaEntry {
  topic:          string;
  avg_score:      number;
  session_count:  number;
  last_practiced: string | null;
  severity:       'critical' | 'needs_work' | 'improving';
  drill_prompt:   string;
}

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
      .sort((a, b) => a.avg_score - b.avg_score); // worst first
  } catch (err) {
    aiLogger.warn('getWeakAreasForUser failed', { userId, error: err });
    return [];
  }
}

// ── Build context string to inject into AI system prompt ──────────

export async function getWeakAreaPromptContext(userId: string): Promise<string> {
  try {
    const rows = await db.getWeakAreas(userId);
    if (!rows || rows.length === 0) return '';

    const weak = rows.filter(r => r.avg_score < 6);
    if (weak.length === 0) return '';

    const list = weak
      .sort((a, b) => a.avg_score - b.avg_score)
      .slice(0, 3)
      .map(r => `${r.topic} (avg ${r.avg_score}/10)`)
      .join(', ');

    return (
      `\n\n⚠️ WEAK AREAS: This user consistently underperforms in: ${list}. ` +
      `Ask questions from these areas and give more detailed feedback for them.`
    );
  } catch {
    return '';
  }
}

// ── Helpers ───────────────────────────────────────────────────────

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
