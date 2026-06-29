/**
 * lib/speech-analysis.ts
 *
 * Pure, dependency-free functions for computing speech quality metrics
 * from a candidate's typed (or transcribed) interview answers.
 *
 * These functions are called once at session end in session/page.tsx
 * and the results are POSTed fire-and-forget to /api/speech-metrics.
 * They are intentionally pure (no side effects, no imports) so they
 * can be unit-tested without a browser environment.
 *
 * Design notes:
 *   - Filler detection uses a fixed word list tuned for Indian English
 *     interview candidates. Code-switch fillers (ahem, basically, na)
 *     are included because they appear frequently in Hinglish mode.
 *   - WPM is estimated from character count, not a real-time timer, so
 *     it is labelled "estimated" in the UI. For typed answers 120 WPM is
 *     a reasonable adult typing baseline; the formula below scales by the
 *     session's actual duration so it reflects typing pace, not reading.
 *   - Both functions return 0 / an empty count on empty input so callers
 *     never need to null-guard.
 */

// Filler word list

// Word-boundary-aware: each entry is matched as a whole word (not a substring).
// Keep sorted alphabetically for easy auditing / diffing.
const FILLER_WORDS = new Set([
  'ah', 'aha', 'ahem',
  'basically',
  'essentially',
  'hmm',
  'i mean',
  'kind of', 'kindof',
  'like',
  'literally',
  'na', 'naa',
  'ok', 'okay',
  'right',
  'so',
  'sort of', 'sortof',
  'uhhh', 'uhh', 'uh',
  'umm', 'um',
  'well',
  'yeah', 'yea',
  'you know', 'youknow',
]);

/**
 * Count total filler-word occurrences across all answers in a session.
 *
 * @param answers - Array of the candidate's answer strings (one per question).
 * @returns Total filler count across all answers.
 */
export function countFillers(answers: string[]): number {
  if (!answers.length) return 0;

  let total = 0;

  for (const raw of answers) {
    if (!raw) continue;

    // Normalise: lowercase, collapse whitespace
    const text = raw.toLowerCase().replace(/\s+/g, ' ').trim();

    // Split on word boundaries. We test both single-word fillers
    // and two-word phrases (e.g. "you know", "i mean").
    // Single-word scan — O(n words)
    const words = text.split(' ');
    for (let i = 0; i < words.length; i++) {
      const word = words[i].replace(/[^a-z]/g, ''); // strip punctuation
      if (FILLER_WORDS.has(word)) {
        total++;
      }
      // Two-word phrase check
      if (i < words.length - 1) {
        const bigram = `${word} ${words[i + 1].replace(/[^a-z]/g, '')}`;
        if (FILLER_WORDS.has(bigram)) {
          total++;
        }
      }
    }
  }

  return total;
}

/**
 * Estimate average words-per-minute across all answers based on word count
 * and total session duration.
 *
 * WPM = (total words) / (duration in minutes)
 *
 * A session of 0 duration (e.g. instant submit) returns 0 to avoid division
 * by zero. Sessions shorter than 30 seconds return 0 because WPM would be
 * artificially inflated by a very short denominator.
 *
 * @param answers       - Array of the candidate's answer strings.
 * @param durationSecs  - Total active session duration in seconds.
 * @returns Estimated WPM rounded to the nearest integer, or 0 if not computable.
 */
export function estimateWPM(answers: string[], durationSecs: number): number {
  if (!answers.length || durationSecs < 30) return 0;

  const totalWords = answers.reduce((sum, a) => {
    if (!a) return sum;
    return sum + a.trim().split(/\s+/).filter(Boolean).length;
  }, 0);

  if (totalWords === 0) return 0;

  const minutes = durationSecs / 60;
  return Math.round(totalWords / minutes);
}
