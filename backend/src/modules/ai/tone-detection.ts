/**
 * Tone Detection — per-turn coaching style adjustment
 *
 * Reads the last user message and returns a short prompt appendix that
 * nudges Aria's response style to match the user's energy. Pure function —
 * no I/O, no state, safe to call on every turn.
 *
 * Three buckets:
 *   anxious   — hedging language, apologies, "I don't know"
 *   confident — assertive, uses jargon, long answers
 *   neutral   — everything else (default)
 *
 * The appendix is intentionally short (<40 tokens) so it doesn't compete
 * with the substantive personalisation context (memory, weak-areas, adaptive).
 * It's appended last so it's closest to the next model turn.
 *
 * Called in buildPromptContext() after the base + personalisation context
 * is assembled, and OUTSIDE the Redis prompt cache (tone is per-turn, not
 * per-session — it must be recomputed from the live rawMessages each call).
 */

export type ToneBucket = 'anxious' | 'confident' | 'neutral';

const ANXIOUS_SIGNALS = [
  /\bi('m| am) not sure\b/i,
  /\bmaybe\b/i,
  /\bprobably\b/i,
  /\bi don't know\b/i,
  /\bsorry\b/i,
  /\bi think\b.*\bbut\b/i,
  /\bnot confident\b/i,
  /\bstruggling\b/i,
  /\bhard for me\b/i,
  /\bnervous\b/i,
];

const CONFIDENT_SIGNALS = [
  /\bwe (implemented|built|designed|architected|led|scaled)\b/i,
  /\bi (implemented|built|designed|architected|led|scaled)\b/i,
  /\bin my experience\b/i,
  /\bour team\b/i,
  /\bI managed\b/i,
  /\bI was responsible for\b/i,
];

/**
 * Detect tone from the last user message in the conversation.
 * Returns 'neutral' if no messages or the last message is from the assistant.
 */
export function detectTone(messages: Array<{ role: string; content: string }>): ToneBucket {
  // Walk backwards to find the most recent user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;

    const text = typeof msg.content === 'string' ? msg.content : '';
    if (!text.trim()) return 'neutral';

    const anxiousHits = ANXIOUS_SIGNALS.filter(re => re.test(text)).length;
    if (anxiousHits >= 2) return 'anxious';

    const confidentHits = CONFIDENT_SIGNALS.filter(re => re.test(text)).length;
    if (confidentHits >= 1) return 'confident';

    return 'neutral';
  }
  return 'neutral';
}

/**
 * Returns the prompt appendix for a given tone bucket.
 * Empty string for neutral — no noise added to the default path.
 */
export function getToneAppendix(tone: ToneBucket): string {
  if (tone === 'anxious') {
    return '\n\nTONE: This candidate seems nervous. Lead with a specific strength before corrections. Keep feedback to one improvement at a time. Use encouraging framing: "Good start — one thing to sharpen:" not "You were wrong about X."';
  }
  if (tone === 'confident') {
    return '\n\nTONE: This candidate is experienced and confident. Skip the hand-holding. Push them harder — ask follow-up questions that probe edge cases and tradeoffs. Challenge assertions with "What would you do if...?" or "How does that hold up at scale?"';
  }
  return ''; // neutral — no appendix needed
}
