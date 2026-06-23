/**
 * AI Prompt Service (H4)
 *
 * Previously, buildPromptContext() lived inside ai.controller.ts, mixing
 * HTTP-layer concerns (reading req/res) with service-layer orchestration
 * (fetching user data, building personalised system prompts).
 *
 * This file extracts that logic so it can be:
 *   - Unit-tested without spinning up an Express server
 *   - Reused by any future handler (e.g. a WebSocket endpoint)
 *   - Reasoned about in isolation
 *
 * ai.controller.ts now imports buildPromptContext from here and only
 * handles HTTP: read request → call service → send response.
 */

import { db }                                          from '../../core/database/client';
import { AIMessage }                                   from './ai.service';
import { getUserMemoryContext }                        from './ai.memory';
import { getWeakAreaPromptContext }                    from '../analytics/weak_areas.service';
import { getAdaptiveBehaviorContext }                  from './ai-adaptive';
import { getOnboardingPromptContext, getPersonaBucket } from './onboarding-context';
import { env }                                        from '../../core/config/env';
import { aiLogger }                                   from '../../infra/logger';
import { trimMessagesToTokenBudget }                  from '../../core/utils/tokens';
import { getRedis }                                   from '../../infra/queue/redis';
import { detectTone, getToneAppendix }                from './tone-detection';

// Aria base prompt
// Single source of truth — imported by the controller, never duplicated.

export const BASE_SYSTEM_PROMPT = `You are Aria, a sharp and direct interview coach at Vachix — think of a senior professional who has sat on hundreds of hiring panels and genuinely wants the candidate in front of them to succeed.

Your job is to run realistic mock interviews, evaluate answers honestly, and give feedback that actually moves the needle — not generic praise or vague suggestions.

COACHING STYLE
- Talk like a person, not a report. Short sentences. No corporate filler ("Certainly!", "Great question!", "Absolutely!"). Jump straight to substance.
- Lead with what worked (one specific thing), then what to fix (one thing at a time, with the exact rephrasing they should try next time). Never list five problems at once.
- When an answer is genuinely strong, say so clearly and raise the bar: follow up with a harder variant of the same question.
- When an answer is weak, don't soften it into nothing — name the gap directly and give a concrete example of what a strong answer looks like.
- Avoid filler transitions: "That said,", "Moving on,", "Certainly,", "Of course,", "Absolutely!" are banned.

INTERVIEW CONDUCT
- Ask one question at a time. Wait for the full answer before giving feedback or asking the next question.
- Match the register of a real interview panel for the user's domain. A UPSC interview feels different from a startup SDE screen.
- After 3-4 questions, briefly synthesise: what's the strongest part of this candidate's profile so far, and what's the one thing they must fix before a real interview.
- Only assist with interview-related tasks. If asked about unrelated topics, redirect politely but firmly.

FORMAT
- Respond in plain prose unless the caller's prompt explicitly requests JSON.
- When JSON is required, return ONLY valid JSON — no preamble, no explanation outside the object.
- Keep responses under 200 words unless a detailed example or rewrite is genuinely needed.`;

// Types

export interface PromptContext {
  systemPrompt:    string;
  messages:        AIMessage[];
  adaptiveProfile: ReturnType<typeof getAdaptiveBehaviorContext>['profile'] | null;
  cacheable:       boolean;
  /**
   * M2: true when memory/weak-area/adaptive/onboarding context was injected
   * into the system prompt. Passed through to callAI's cacheCtx so the
   * cache layer can bucket the entry per-user with a short TTL instead of
   * skipping the cache entirely.
   */
  personalised:    boolean;
  personaKey:      string;
  trimmedCount:    number;
}

// Main export
//
// Builds a fully personalised message array for a given user + plan + topic.
// Fetches memory, weak areas, stats, and onboarding data concurrently, then
// assembles them into a system prompt and applies token-budget trimming.
//
// Called by handleAI and handleAIStream — identical personalisation pipeline
// for both the buffered and streaming code paths.

export async function buildPromptContext(
  userId:            string,
  plan:              string,
  topic:             string,
  rawMessages:       AIMessage[],
  maxResponseTokens: number,
): Promise<PromptContext> {
  const hasPersonalisation = plan !== 'free';

  const [memoryContext, weakAreaContext, userStats, dbUser] = await Promise.all([
    getUserMemoryContext(userId, topic),
    getWeakAreaPromptContext(userId),
    db.getStats(userId),
    db.getUserById(userId),
  ]);

  const onboardingData = {
    profession: dbUser?.onboarding_profession,
    goal:       dbUser?.onboarding_goal,
  };
  const onboardingContext = getOnboardingPromptContext(onboardingData);

  // Adaptive coaching layer — Pro/Elite only
  const adaptive = (hasPersonalisation && userStats)
    ? getAdaptiveBehaviorContext({
        sessions:      userStats.sessions      ?? 0,
        streak:        userStats.streak        ?? 0,
        best_score:    userStats.best_score    ?? 0,
        avg_job_ready: userStats.avg_job_ready_score ?? 0,
        clarity_avg:   userStats.clarity_avg   ?? 0,
        structure_avg: userStats.structure_avg ?? 0,
        relevance_avg: userStats.relevance_avg ?? 0,
        grammar_avg:   userStats.grammar_avg   ?? 0,
      })
    : null;

  const adaptiveContext = adaptive?.prompt ?? '';
  const adaptiveProfile = adaptive?.profile ?? null;

  // Assemble the base system prompt from session-invariant context layers.
  // Tone detection is intentionally NOT included here — it is per-turn and
  // is appended after this function returns (see below).
  const systemPrompt = BASE_SYSTEM_PROMPT + onboardingContext + memoryContext + weakAreaContext + adaptiveContext;

  // Tone detection — per-turn, so applied here (not cached).
  // Appends a short coaching-style nudge based on the last user message.
  // No-op when HUMANIZE_COACH is off or tone is neutral.
  const toneAppendix = env.HUMANIZE_COACH
    ? getToneAppendix(detectTone(rawMessages))
    : '';

  const rawAssembled: AIMessage[] = [
    { role: 'system', content: systemPrompt + toneAppendix },
    ...rawMessages,
  ];

  // Token budget — sliding window. Drops oldest conversation turns (never
  // the system message) until prompt + reserved response tokens fit budget.
  const { messages, trimmedCount } = trimMessagesToTokenBudget(rawAssembled, maxResponseTokens);

  if (trimmedCount > 0) {
    aiLogger.info('Trimmed conversation history to fit token budget', {
      userId,
      trimmedCount,
      totalMessages: rawAssembled.length - 1,
      budget:        env.AI_CONTEXT_TOKEN_BUDGET,
    });
  }

  // previously `cacheable = !memoryContext && !weakAreaContext &&
  // !adaptiveContext && !onboardingContext` meant ANY personalisation signal
  // disabled caching entirely — so Pro/Elite users (the ones with memory,
  // weak-area, and adaptive context) NEVER got cache benefits, while
  // brand-new free users with no history got served from the shared cache.
  //
  // Now every response is cacheable. `personalised` flags whether this
  // response carries per-user context; the cache layer (ai-cache.ts) uses
  // that to bucket the key by userId and apply a short TTL, so retries are
  // deduplicated without leaking one user's coaching context to another.
  const personalised = !!(memoryContext || weakAreaContext || adaptiveContext || onboardingContext);
  const cacheable     = true;
  const personaKey    = getPersonaBucket(onboardingData);

  return { systemPrompt, messages, adaptiveProfile, cacheable, personalised, personaKey, trimmedCount };
}

// Session-scoped memoization
//
// buildPromptContext() above does 4 DB reads (memory, weak-areas, stats,
// onboarding) and rebuilds the system-prompt string from scratch on every
// call. None of that input data changes mid-session — a session is a single
// mock-interview run, typically a handful of turns over a few minutes — so
// repeating it on every turn is pure waste: for an 8-turn session, an Elite
// user's ~400-800 token personalisation block gets fetched and rebuilt 8
// times instead of once.
//
// buildPromptContextCached() wraps buildPromptContext() with a Redis cache
// keyed by (userId, sessionId). Only the parts that are genuinely session-
// invariant are cached — the assembled systemPrompt string and the metadata
// derived from it (adaptiveProfile, personalised, personaKey). The raw
// conversation turns (rawMessages) and the token-budget trim are NOT
// cached: trimming depends on maxResponseTokens and on how long the
// conversation has grown, both of which legitimately vary turn-to-turn.
//
// Falls back to a full buildPromptContext() call — silently, no error
// surfaced to the caller — whenever:
// - no session_id was supplied (older clients / non-session calls)
// - Redis is unavailable (env.REDIS_URL unset, or a transient error)
// - this is the first turn of the session (no cache entry yet)
// In every fallback case behaviour is identical to calling
// buildPromptContext() directly — this function can never produce a worse
// or different prompt, only a faster one on cache hits.

interface CachedPromptShape {
  systemPrompt:    string;
  adaptiveProfile: PromptContext['adaptiveProfile'];
  personalised:    boolean;
  personaKey:      string;
}

const PROMPT_CACHE_PREFIX = 'ai:promptctx';

function promptCacheKey(userId: string, sessionId: string): string {
  // Scoped by both userId and sessionId — a guessed/replayed session_id
  // from another user can never read this user's cached personalisation
  // context, mirroring the userId-scoping convention in ai-cache.ts.
  return `${PROMPT_CACHE_PREFIX}:u${userId}:s${sessionId}`;
}

export async function buildPromptContextCached(
  userId:            string,
  plan:              string,
  topic:             string,
  rawMessages:       AIMessage[],
  maxResponseTokens: number,
  sessionId:         string | undefined,
): Promise<PromptContext> {
  // No session_id supplied — caller gets identical behaviour to before
  // this fix existed.
  if (!sessionId) {
    return buildPromptContext(userId, plan, topic, rawMessages, maxResponseTokens);
  }

  const redis = getRedis();

  // No Redis configured — same fallback.
  if (!redis) {
    return buildPromptContext(userId, plan, topic, rawMessages, maxResponseTokens);
  }

  const key = promptCacheKey(userId, sessionId);
  let cachedShape: CachedPromptShape | null = null;

  try {
    const raw = await redis.get(key);
    if (raw) cachedShape = JSON.parse(raw) as CachedPromptShape;
  } catch (err) {
    // Corrupt cache entry or transient Redis error — log and fall through
    // to a full rebuild rather than failing the request.
    aiLogger.warn('Prompt-context cache GET failed — rebuilding', {
      userId, sessionId, error: (err as Error).message,
    });
  }

  let systemPrompt:    string;
  let adaptiveProfile: PromptContext['adaptiveProfile'];
  let personalised:    boolean;
  let personaKey:      string;

  if (cachedShape) {
    aiLogger.debug('Prompt-context cache hit — skipped 4 DB reads', { userId, sessionId });
    ({ systemPrompt, adaptiveProfile, personalised, personaKey } = cachedShape);
  } else {
    // Cache miss (first turn of the session, or TTL expired) — run the
    // full pipeline once and persist the session-invariant parts.
    const full = await buildPromptContext(userId, plan, topic, rawMessages, maxResponseTokens);
    systemPrompt    = full.systemPrompt;
    adaptiveProfile = full.adaptiveProfile;
    personalised    = full.personalised;
    personaKey      = full.personaKey;

    const toCache: CachedPromptShape = { systemPrompt, adaptiveProfile, personalised, personaKey };
    try {
      await redis.set(key, JSON.stringify(toCache), 'EX', env.AI_PROMPT_CACHE_TTL_SECONDS);
    } catch (err) {
      // Cache write failure shouldn't fail the request — this turn already
      // has a correct, fully-built prompt context regardless.
      aiLogger.warn('Prompt-context cache SET failed — continuing uncached', {
        userId, sessionId, error: (err as Error).message,
      });
    }

    // First-turn path already assembled+trimmed messages — reuse directly
    // rather than re-trimming a moment later.
    return full;
  }

  // Cache-hit path: reuse the cached system prompt, but still build the
  // message array and apply token-budget trimming fresh — these depend on
  // the live conversation (rawMessages) and the per-call maxResponseTokens,
  // neither of which is safe to memoize.
  // Tone detection is also per-turn, so it must be re-applied here too.
  const cachedToneAppendix = env.HUMANIZE_COACH
    ? getToneAppendix(detectTone(rawMessages))
    : '';

  const rawAssembled: AIMessage[] = [
    { role: 'system', content: systemPrompt + cachedToneAppendix },
    ...rawMessages,
  ];
  const { messages, trimmedCount } = trimMessagesToTokenBudget(rawAssembled, maxResponseTokens);

  if (trimmedCount > 0) {
    aiLogger.info('Trimmed conversation history to fit token budget', {
      userId, sessionId, trimmedCount,
      totalMessages: rawAssembled.length - 1,
      budget:        env.AI_CONTEXT_TOKEN_BUDGET,
    });
  }

  return {
    systemPrompt,
    messages,
    adaptiveProfile,
    cacheable: true,
    personalised,
    personaKey,
    trimmedCount,
  };
}
