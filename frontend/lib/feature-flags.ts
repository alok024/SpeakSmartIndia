/**
 * feature-flags.ts
 *
 * Centralised feature gating for Vachix.
 *
 * All flags are evaluated at call-time (not cached) so that:
 *   - Server-side rendering always sees the correct value
 *   - React Server Components can call `isEnabled()` without a
 *     `typeof window` guard
 *   - Tests can override `process.env` without module re-import
 *
 * Usage:
 *   import { FLAG } from '@/lib/feature-flags';
 *   if (FLAG.SPEECH_ANALYTICS_CARD) { ... }
 */

// Flag registry

export const FLAG = {
  /**
   * Speech analytics card on the session summary screen.
   * Shows WPM, filler-word count, and clarity breakdown.
   * Env: NEXT_PUBLIC_FF_SPEECH_ANALYTICS_CARD=true
   */
  SPEECH_ANALYTICS_CARD:
    process.env.NEXT_PUBLIC_FF_SPEECH_ANALYTICS_CARD === 'true',

  /**
   * UI-only flag: show "Humanised Coach" badge or copy in the frontend.
   * The actual backend behaviour (warm tone detection + prompt rewrite) is
   * gated by the server env var `HUMANIZE_COACH=true/false` — this
   * NEXT_PUBLIC_ var only exists in the browser bundle.
   * Env: NEXT_PUBLIC_FF_HUMANIZED_COACH_PROMPT=true
   */
  HUMANIZED_COACH_PROMPT:
    process.env.NEXT_PUBLIC_FF_HUMANIZED_COACH_PROMPT === 'true',
} as const;

export type FeatureFlag = keyof typeof FLAG;

/**
 * Type-safe helper — prefer the FLAG object directly for static checks,
 * use this only when the flag name comes from a variable.
 */
export function isEnabled(flag: FeatureFlag): boolean {
  return FLAG[flag];
}
