/**
 * lib/query-keys.ts
 *
 * Centralized React Query key registry.
 *
 * Query keys live here — not inside individual feature `hooks/` modules —
 * so any feature can invalidate another feature's cache without creating
 * a circular import. E.g. `features/interview` invalidates `QK.me` and
 * `QK.sessions` after saving a session, without importing from
 * `features/user` or `features/analytics`.
 *
 * If a feature's queries are never invalidated cross-feature, it's fine
 * to keep that key local to the feature's hooks file instead — this file
 * is for shared keys only.
 */
export const QK = {
  me: ['me'] as const,
  sessions: ['sessions'] as const,
  session: (id: string) => ['session', id] as const,
  scoreHistory: (limit: number) => ['score-history', limit] as const,
  referral: ['referral'] as const,
  readinessReport: ['readiness-report'] as const,
  speechTrend:     ['speech-trend'] as const,
  elaraJourney:    ['elara-journey'] as const,
  elaraVocab:      ['elara-vocab'] as const,
  leaderboard:     ['leaderboard'] as const,
};
