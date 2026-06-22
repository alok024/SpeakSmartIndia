/**
 * Job-Ready Score Engine
 *
 * Computes a composite 0–100 "job readiness" score from a session's
 * per-question feedback array. The four dimensions and their weights:
 *
 *   Clarity    30% — average AI-assigned quality score (0–10 per question)
 *   Structure  25% — presence of STAR-method components in the answer
 *   Relevance  25% — answer length and absence of off-topic tip keywords
 *   Grammar    20% — deduction per detected language error
 *
 * Each dimension is computed as a 0–10 value; multiplying the weighted
 * sum by 10 yields the 0–100 composite.
 *
 * Design note: all inputs are optional fields on FeedbackForScoring, so the
 * engine degrades gracefully when the AI omits a field rather than returning
 * a corrupt or NaN score.
 */

export interface ScoreBreakdown {
  clarity:   number; // 0–10
  structure: number; // 0–10
  relevance: number; // 0–10
  grammar:   number; // 0–10
  jobReady:  number; // 0–100 composite
  rawAvg:    number; // plain mean of per-question scores (legacy compat)
}

export interface FeedbackForScoring {
  score?:          number;
  english_errors?: string[];
  corrections?:    unknown[];
  structure?:      Record<string, unknown>;
  tips?:           string;
  answer?:         string;
}

// Main export
export function computeScoreBreakdown(feedbacks: FeedbackForScoring[]): ScoreBreakdown {
  if (!feedbacks || feedbacks.length === 0) {
    return { clarity: 0, structure: 0, relevance: 0, grammar: 0, jobReady: 0, rawAvg: 0 };
  }

  // Clarity: straight average of the per-question AI score.
  const clarity = avg(feedbacks.map(f => f.score ?? 5));

  // Structure: inferred from the richness of the AI's `structure` object.
  // More detected structural components → higher score. Cap at 10.
  const structure = avg(feedbacks.map(f => {
    const s = f.structure;
    if (!s || typeof s !== 'object') return 3;
    const keys = Object.keys(s).length;
    return Math.min(10, 3 + keys * 1.5);
  }));

  // Grammar: start at 10 and deduct 1.5 per detected error. Counts both
  // `english_errors` (array of strings) and `corrections` (legacy field).
  const grammar = avg(feedbacks.map(f => {
    const errors = (f.english_errors?.length ?? 0)
      + (Array.isArray(f.corrections) ? f.corrections.length : 0);
    return Math.max(0, 10 - errors * 1.5);
  }));

  // Relevance: word-count proxy, penalised by off-topic tip keywords.
  //
  // Guard against JS split quirk: ''.split(/\s+/) → [''] (length 1) and
  // '   '.split(/\s+/) → ['', ''] (length 2), both of which would assign a
  // non-zero base score to a blank or whitespace-only answer. Trim first so
  // genuinely empty answers correctly score 0.
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

  // Composite: weighted sum scaled to 0–100.
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

// Readiness label (UI)
/**
 * Maps a 0–100 job-readiness score to a display label, colour, and
 * coaching message for the results screen and certificate.
 */
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

// Private helpers
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
