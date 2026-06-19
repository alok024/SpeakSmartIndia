import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function esc(str: unknown): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function parseJsonArray(raw: string): string[] {
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1) return [];
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    // Fix: The old threshold was > 10 chars, which silently dropped short
    // but valid questions like "Why IT?" (7 chars) or "Tell me about yourself."
    // (short variants). This caused the session to start with fewer questions
    // than config.totalQ — the progress bar would show "Q1/4" when 5 were
    // requested, and the last question slot would be blank, crashing submitAnswer.
    // Lowered to > 3 to filter out only empty strings and garbage tokens
    // (e.g. stray commas, whitespace-only items). Structure validation via
    // Zod in parseFeedbackJson already handles malformed feedback separately.
    return parsed.filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 3
    );
  } catch {
    return [];
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

export function scoreColor(score: number): string {
  if (score >= 7) return 'text-emerald-400';
  if (score >= 4) return 'text-amber-400';
  return 'text-red-400';
}

export function scoreBg(score: number): string {
  if (score >= 7) return 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20';
  if (score >= 4) return 'bg-amber-400/10 text-amber-400 border-amber-400/20';
  return 'bg-red-400/10 text-red-400 border-red-400/20';
}
