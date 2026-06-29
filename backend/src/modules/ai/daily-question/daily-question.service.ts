/**
 * Daily Question Drop — one Groq-generated question per IST calendar day.
 *
 * One question per IST calendar day, shown on the dashboard. Generated
 * once (lazily, on first read of the day) via the existing Groq
 * integration, then served from `daily_questions` for every subsequent
 * request that day — no per-request AI call, no per-user variation.
 *
 * Race safety: db.createDailyQuestionIfMissing() handles the case where
 * two requests both miss the cache for the same new day; see its
 * doc-comment in core/database/client.ts for the resolution.
 */

import { db } from '../../../core/database/client';
import { callAI, AIMessage } from '../chat/chat.service';
import { aiLogger } from '../../../infra/logger';
import type { DailyQuestionRow } from '../../../core/database/client';

const log = aiLogger.child({ module: 'daily-question' });

// Same roster used by the interview setup screen (frontend/app/(app)/
// interview/setup/page.tsx PROFESSIONS) — kept as a small local copy
// rather than a shared import since this is backend-only and the list
// rarely changes. Rotated by day-of-year so the same profession doesn't
// repeat back-to-back across most of a month.
const PROFESSIONS = [
  'Software Developer', 'Java Developer', 'Government Job (SSC/UPSC)',
  'Data Scientist', 'Doctor / Medical', 'Teacher', 'Bank PO',
  'Marketing Manager', 'Full Stack Developer', 'Police / Defence',
];

function istDateToday(): string {
  // Same IST-conversion approach used elsewhere (voice.controller.ts
  // warm-up key, 009_streak_timezone_ist.sql) — fixed +5:30 offset,
  // no DST in India.
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function professionForDate(date: string): string {
  // Deterministic by date — every reader the same day computes the same
  // profession, so a cache-miss race still produces a coherent question
  // (both concurrent generators would pick the same profession).
  const dayOfYear = Math.floor(
    (new Date(date + 'T00:00:00Z').getTime() - new Date(date.slice(0, 4) + '-01-01T00:00:00Z').getTime())
    / 86_400_000
  );
  return PROFESSIONS[dayOfYear % PROFESSIONS.length];
}

async function generateQuestion(profession: string): Promise<string> {
  const messages: AIMessage[] = [
    {
      role: 'system',
      content:
        'You are Aria, an expert interview coach. Generate exactly ONE realistic ' +
        'interview question for the given profession — the kind a real hiring ' +
        'manager would actually ask, not a generic "tell me about yourself". ' +
        'Reply with ONLY the question text, no preamble, no quotes, no numbering.',
    },
    { role: 'user', content: `Profession: ${profession}` },
  ];

  // Not cached via callAI's own cache layer — the daily_questions table
  // IS the cache (one row per day), so this call only ever runs once per
  // day regardless of how many users hit the dashboard.
  const response = await callAI(messages, 100, { cacheable: false });
  return response.text.trim().replace(/^["']|["']$/g, '');
}

/**
 * Returns today's (IST) daily question, generating and persisting it on
 * first read of the day. Returns null only if generation itself failed
 * (e.g. both Groq and the OpenAI fallback are down) — the dashboard
 * renders nothing in that case rather than showing a fake question.
 */
export async function getTodaysDailyQuestion(): Promise<DailyQuestionRow | null> {
  const date = istDateToday();

  const existing = await db.getDailyQuestion(date);
  if (existing) return existing;

  const profession = professionForDate(date);

  try {
    const question = await generateQuestion(profession);
    if (!question) {
      log.warn('Daily question generation returned empty text', { date, profession });
      return null;
    }
    return await db.createDailyQuestionIfMissing(date, question, profession);
  } catch (err) {
    log.warn('Daily question generation failed — dashboard will show nothing today', {
      date, profession, error: (err as Error).message,
    });
    return null;
  }
}
