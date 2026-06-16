/**
 * Token budgeting (Issue 8)
 *
 * AIRequestSchema already caps conversation length (max 100 messages) and
 * per-message size (max 32K chars), but a conversation anywhere near those
 * caps — combined with the personalisation context injected into the
 * system prompt (memory, weak areas, adaptive coaching, onboarding) — can
 * still produce a prompt far larger than the model's usable context window.
 *
 * trimMessagesToTokenBudget() is the sliding window referenced in the
 * audit: it always keeps the system message(s) and the most recent
 * conversation turns, dropping the oldest turns first until the estimated
 * prompt size (+ reserved response tokens) fits within
 * env.AI_CONTEXT_TOKEN_BUDGET.
 */

import { env } from '../config/env';

export interface TextMessage {
  role:    string;
  content: string;
}

export interface TrimResult<T extends TextMessage> {
  messages:        T[];
  trimmedCount:    number;
  estimatedTokens: number;
}

// Rough heuristic — ~4 characters per token for English text. Good enough
// for budget enforcement; pulling in a real tokenizer isn't worth the
// dependency for a soft safety margin.
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Trims `messages` to fit within `contextBudget` total tokens, reserving
 * `maxResponseTokens` for the model's reply.
 *
 * - System messages are never trimmed — they carry the persona, onboarding,
 *   memory, weak-area, and adaptive-coaching context and are small relative
 *   to a long conversation.
 * - Conversation messages (user/assistant) are walked from most-recent to
 *   oldest; the most recent turn is always kept even if it alone exceeds
 *   the remaining budget. Older turns are dropped once the running total
 *   would exceed the available budget.
 * - Relative order of kept messages is preserved (system first, then the
 *   retained conversation tail in original order).
 */
export function trimMessagesToTokenBudget<T extends TextMessage>(
  messages:          T[],
  maxResponseTokens: number,
  contextBudget:     number = env.AI_CONTEXT_TOKEN_BUDGET,
): TrimResult<T> {
  const systemMessages = messages.filter(m => m.role === 'system');
  const conversation    = messages.filter(m => m.role !== 'system');

  const systemTokens = systemMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const available     = Math.max(contextBudget - systemTokens - maxResponseTokens, 0);

  const kept: T[] = [];
  let used = 0;
  for (let i = conversation.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(conversation[i].content);
    // Always keep the most recent turn, even if it alone exceeds `available`.
    if (kept.length > 0 && used + tokens > available) break;
    used += tokens;
    kept.unshift(conversation[i]);
  }

  return {
    messages:        [...systemMessages, ...kept],
    trimmedCount:    conversation.length - kept.length,
    estimatedTokens: systemTokens + used,
  };
}
