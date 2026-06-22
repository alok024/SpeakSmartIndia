/**
 * lib/utils.ts
 *
 * Shared client-side utilities: class merging, HTML escaping,
 * AI-response parsing, date formatting, and score colour helpers.
 *
 * Keep this file small and pure — no network calls, no React, no Zustand.
 * If a helper needs component context, it belongs in a hook instead.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind class names, resolving conflicts via tailwind-merge.
 * Prefer this over raw `clsx` everywhere in this codebase so conflicting
 * utilities (e.g. `p-2` vs `p-4`) are resolved predictably.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * HTML-escapes a value for safe rendering in template strings or
 * dangerouslySetInnerHTML contexts. Returns an empty string for null/undefined.
 */
export function esc(str: unknown): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Extracts a string array from a raw AI response that may be wrapped in
 * markdown code fences (```json ... ```) or contain leading/trailing prose.
 *
 * Filtering threshold is intentionally low (> 3 chars) so short-but-valid
 * questions like "Why IT?" or "Tell me about yourself?" are not dropped.
 * Only empty strings and stray tokenization artifacts (commas, whitespace)
 * are filtered out. Zod validation in parseFeedbackJson handles structural
 * validation of the feedback object separately.
 */
export function parseJsonArray(raw: string): string[] {
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1) return [];
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 3
    );
  } catch {
    return [];
  }
}

/** Promise-based delay. Useful for debounce and retry back-off. */
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Formats an ISO timestamp for the en-IN locale: "12 Jan 2025". */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Compact date format for tight spaces: "12 Jan" (no year). */
export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Maps a 0–10 score to a Tailwind text-colour class.
 * ≥ 7 → green, ≥ 4 → amber, < 4 → red.
 */
export function scoreColor(score: number): string {
  if (score >= 7) return 'text-emerald-400';
  if (score >= 4) return 'text-amber-400';
  return 'text-red-400';
}

/**
 * Maps a 0–10 score to a Tailwind background + border + text class set,
 * suitable for badge/pill components. Same thresholds as scoreColor.
 */
export function scoreBg(score: number): string {
  if (score >= 7) return 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20';
  if (score >= 4) return 'bg-amber-400/10 text-amber-400 border-amber-400/20';
  return 'bg-red-400/10 text-red-400 border-red-400/20';
}
