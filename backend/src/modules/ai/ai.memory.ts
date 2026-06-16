/**
 * AI Memory Service
 *
 * Stores recurring mistakes per user across sessions.
 * Injected into Aria's system prompt so she remembers past errors.
 *
 * Flow:
 *   1. After session save → persistMistakesFromFeedback()
 *   2. Before AI call    → getUserMemoryContext() → inject into system prompt
 */

import { db } from '../../core/database/client';
import { logger } from '../../infra/logger';

const log = logger.child({ module: 'ai-memory' });

// ── Type guard ────────────────────────────────────────────────────
function isCorrectionObject(c: unknown): c is { error: string } {
  return typeof c === 'object' && c !== null && 'error' in c && typeof (c as Record<string, unknown>).error === 'string';
}


// ── Types ─────────────────────────────────────────────────────────

export interface MistakeRecord {
  topic:        string;
  mistake_type: 'grammar' | 'structure' | 'confidence' | 'content' | 'vocabulary' | 'clarity';
  description:  string;
}

export interface FeedbackItem {
  q?:              string;
  question?:       string;
  score?:          number;
  english_errors?: string[];
  corrections?:    unknown[];
  tips?:           string;
  structure?:      Record<string, unknown>;
}

// ── Extract + persist mistakes from a session's feedback ──────────

export async function persistMistakesFromFeedback(
  userId:    string,
  topic:     string,
  feedbacks: FeedbackItem[]
): Promise<void> {
  try {
    const mistakes: MistakeRecord[] = [];

    for (const f of feedbacks) {
      const score = f.score ?? 10;

      // Grammar mistakes from error arrays
      const corrections = Array.isArray(f.english_errors)
        ? f.english_errors
        : Array.isArray(f.corrections)
          ? (f.corrections as unknown[]).map(c =>
              typeof c === 'string' ? c : (isCorrectionObject(c) ? c.error : '')
            )
          : [];

      for (const err of corrections) {
        if (err && err.length > 5) {
          mistakes.push({
            topic,
            mistake_type: 'grammar',
            description:  normalizeDescription(err),
          });
        }
      }

      // Low score → content weakness
      if (score < 5) {
        mistakes.push({
          topic,
          mistake_type: 'content',
          description:  `Low-quality answers in ${topic} interviews (scored ${score}/10)`,
        });
      }

      // Low score → structure weakness
      if (score < 6) {
        mistakes.push({
          topic,
          mistake_type: 'structure',
          description:  `Unstructured answers in ${topic} — needs STAR method`,
        });
      }

      // Tip-based confidence flag
      if (f.tips && /confiden|hesitat|uncertain|nervous/i.test(f.tips)) {
        mistakes.push({
          topic,
          mistake_type: 'confidence',
          description:  `Shows hesitation/uncertainty in ${topic} responses`,
        });
      }
    }

    if (mistakes.length === 0) return;

    // Upsert each mistake (increment occurrences if already exists)
    await Promise.allSettled(
      mistakes.map(m =>
        db.rpc_upsert_mistake({
          p_user_id:      userId,
          p_topic:        m.topic,
          p_mistake_type: m.mistake_type,
          p_description:  m.description,
        })
      )
    );

    log.info('Persisted mistakes from session', { userId, count: mistakes.length });
  } catch (err) {
    log.warn('Failed to persist mistakes (non-fatal)', { userId, error: err });
  }
}

// ── Build memory context string for AI prompt ─────────────────────

export async function getUserMemoryContext(
  userId: string,
  topic:  string
): Promise<string> {
  try {
    const mistakes = await db.getUserMistakes(userId, topic);
    if (!mistakes || mistakes.length === 0) return '';

    const top = mistakes
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 5);

    const lines = top.map(m =>
      `- [${m.mistake_type.toUpperCase()}] ${m.description} (seen ${m.occurrences}x)`
    );

    return (
      `\n\n📋 MEMORY — This user's recurring mistakes:\n${lines.join('\n')}\n` +
      `Address these patterns subtly in your feedback. If they repeat a known mistake, point it out explicitly.`
    );
  } catch (err) {
    log.warn('Failed to fetch memory context (non-fatal)', { userId, error: err });
    return '';
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function normalizeDescription(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .slice(0, 120);
}
