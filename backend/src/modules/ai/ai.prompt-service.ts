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

// Aria base prompt
// Single source of truth — imported by the controller, never duplicated.

export const BASE_SYSTEM_PROMPT =
  `You are Aria, an AI interview coach for Vachix. ` +
  `Help users practice job interviews, evaluate their answers, give structured feedback, ` +
  `and improve their English communication. Only assist with interview-related tasks. ` +
  `Be concise and direct. Always respond with valid JSON when asked.`;

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

  const systemPrompt = BASE_SYSTEM_PROMPT + onboardingContext + memoryContext + weakAreaContext + adaptiveContext;

  const rawAssembled: AIMessage[] = [
    { role: 'system', content: systemPrompt },
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

  // M2: previously `cacheable = !memoryContext && !weakAreaContext &&
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

// Session-scoped memoization (Fix S1)
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
//   - no session_id was supplied (older clients / non-session calls)
//   - Redis is unavailable (env.REDIS_URL unset, or a transient error)
//   - this is the first turn of the session (no cache entry yet)
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
  const rawAssembled: AIMessage[] = [
    { role: 'system', content: systemPrompt },
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
