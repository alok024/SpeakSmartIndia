/**
 * Job-Ready Score Engine
 *
 * Computes a 0–100 composite score per session from feedback arrays.
 *
 * Formula:
 *   clarity    × 0.30
 *   structure  × 0.25
 *   relevance  × 0.25
 *   grammar    × 0.20
 *
 * Each dimension is 0–10, multiplied by 10 to reach 0–100.
 */

export interface ScoreBreakdown {
  clarity:   number; // 0–10
  structure: number; // 0–10
  relevance: number; // 0–10
  grammar:   number; // 0–10
  jobReady:  number; // 0–100 composite
  rawAvg:    number; // plain avg of per-question scores (legacy compat)
}

export interface FeedbackForScoring {
  score?:          number;
  english_errors?: string[];
  corrections?:    unknown[];
  structure?:      Record<string, unknown>;
  tips?:           string;
  answer?:         string;
}

// ── Main export ───────────────────────────────────────────────────

export function computeScoreBreakdown(feedbacks: FeedbackForScoring[]): ScoreBreakdown {
  if (!feedbacks || feedbacks.length === 0) {
    return { clarity: 0, structure: 0, relevance: 0, grammar: 0, jobReady: 0, rawAvg: 0 };
  }

  // Clarity: average per-question AI score (1–10)
  const clarity = avg(feedbacks.map(f => f.score ?? 5));

  // Structure: how well answers are structured (based on structure object keys)
  const structure = avg(feedbacks.map(f => {
    const s = f.structure;
    if (!s || typeof s !== 'object') return 3;
    const keys = Object.keys(s).length;
    return Math.min(10, 3 + keys * 1.5);
  }));

  // Grammar: penalise for each error found
  const grammar = avg(feedbacks.map(f => {
    const errors = (f.english_errors?.length ?? 0)
      + (Array.isArray(f.corrections) ? f.corrections.length : 0);
    return Math.max(0, 10 - errors * 1.5);
  }));

  // Relevance: proxy via answer length + negative tip keywords.
  // Guard against JS split quirk: ''.split(/\s+/) → [''] (length 1) and
  // '   '.split(/\s+/) → ['', ''] (length 2), both of which would assign a
  // non-zero base score to a fully skipped answer.  Trim first so genuinely
  // empty or whitespace-only answers correctly score 0.
  const relevance = avg(feedbacks.map(f => {
    const trimmed = (f.answer || '').trim();
    if (!trimmed) return 0;
    const wordCount = trimmed.split(/\s+/).length;
    let score = Math.min(10, 3 + wordCount * 0.08);
    if (f.tips && /irrelevant|off.topic|didn.t answer|avoid/i.test(f.tips)) {
      score = Math.max(0, score - 3);
    }
    return score;
  }));

  // Composite 0–100
  const jobReady = clamp(
    (clarity * 0.30 + structure * 0.25 + relevance * 0.25 + grammar * 0.20) * 10,
    0, 100
  );

  const rawAvg = avg(feedbacks.map(f => f.score ?? 5));

  return {
    clarity:   round2(clarity),
    structure: round2(structure),
    relevance: round2(relevance),
    grammar:   round2(grammar),
    jobReady:  round2(jobReady),
    rawAvg:    round2(rawAvg),
  };
}

// ── Readiness label for UI ────────────────────────────────────────

export function getReadinessLabel(score: number): {
  label:   string;
  color:   string;
  message: string;
} {
  if (score >= 85) return {
    label:   'Interview Ready',
    color:   '#22c55e',
    message: 'You are ready to crack most interviews. Keep practicing.',
  };
  if (score >= 70) return {
    label:   'Almost There',
    color:   '#3b82f6',
    message: 'Strong candidate. Work on your weaker areas.',
  };
  if (score >= 55) return {
    label:   'Improving',
    color:   '#f59e0b',
    message: 'Good progress. Focus on structure and grammar.',
  };
  if (score >= 40) return {
    label:   'Needs Practice',
    color:   '#f97316',
    message: 'Keep practicing daily. Try shorter, structured answers.',
  };
  return {
    label:   'Beginner',
    color:   '#ef4444',
    message: 'Start with HR questions. Build confidence before technical.',
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
