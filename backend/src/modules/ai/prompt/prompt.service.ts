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

import { db }                                          from '../../../core/database/client';
import { AIMessage }                                   from '../chat/chat.service';
import { getUserMemoryContext }                        from '../memory/memory.service';
import { getWeakAreaPromptContext }                    from '../../analytics/reports/weak-areas.service';
import { getAdaptiveBehaviorContext }                  from './adaptive';
import { getOnboardingPromptContext, getPersonaBucket, getDAFPromptContext, getCompanyModePromptContext } from './onboarding-context';
import { env }                                        from '../../../core/config/env';
import { aiLogger }                                   from '../../../infra/logger';
import { trimMessagesToTokenBudget }                  from '../../../core/utils/tokens';
import { getRedis }                                   from '../../../infra/queue/redis';
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

// Track-scoped personalisation gating
//
// DAF (UPSC Detailed Application Form) and company-mode context are tied to
// specific tracks/professions — DAF only makes sense for UPSC sessions,
// company mode only for Software Developer / Full Stack Developer / Data
// Scientist sessions with a company selected. Both are stored on the user's
// row (persisted once, reused across sessions), so without an explicit check
// against *this session's* topic they would otherwise leak into unrelated
// interviews — e.g. a user who once filled their UPSC DAF getting "you
// mentioned mountaineering as a hobby" questions injected into a Software
// Developer mock interview, or a stale Amazon company-mode selection
// bleeding into a UPSC session.
//
// Keyword sets mirror the matching already used client-side (DAFSection's
// isUpscUser check in profile/page.tsx) and the canonical TrackMeta.profession
// strings in frontend/lib/interview-prompts.ts, so a custom/free-typed
// profession ("IAS Officer", "Senior Software Developer") still gates the
// same way a track-picker selection would.

const UPSC_TOPIC_KEYWORDS = ['upsc', 'civil service', 'ias', 'ips', 'ifs', 'irs'];
const COMPANY_MODE_TOPIC_KEYWORDS = ['software developer', 'full stack developer', 'data scientist'];

function isUpscTopic(topic: string | undefined | null): boolean {
  const t = (topic || '').toLowerCase();
  return UPSC_TOPIC_KEYWORDS.some((k) => t.includes(k));
}

function isCompanyModeEligibleTopic(topic: string | undefined | null): boolean {
  const t = (topic || '').toLowerCase();
  return COMPANY_MODE_TOPIC_KEYWORDS.some((k) => t.includes(k));
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

  // DAF context — UPSC sessions only; no-op for all other tracks.
  // Gated on the CURRENT session's topic (not just "does the user have DAF
  // data saved"), so a user who filled their DAF for UPSC prep doesn't get
  // it injected into an unrelated track's session.
  const dafContext = isUpscTopic(topic)
    ? getDAFPromptContext({
        name:               dbUser?.daf_name,
        home_state:         dbUser?.daf_home_state,
        graduation_subject: dbUser?.daf_graduation_subject,
        graduation_college: dbUser?.daf_graduation_college,
        optional_subject:   dbUser?.daf_optional_subject,
        hobbies:            dbUser?.daf_hobbies,
        work_experience:    dbUser?.daf_work_experience,
        extracurriculars:   dbUser?.daf_extracurriculars,
      })
    : '';

  // Company-mode context — injected only when this session's topic is one
  // of the three tracks that support campus company-mode (Software
  // Developer / Full Stack Developer / Data Scientist) AND the user has a
  // company target saved. Without the topic gate, a stale last_company_mode
  // from a previous SDE session would otherwise leak into e.g. a UPSC or
  // Bank PO session.
  const companyModeContext = isCompanyModeEligibleTopic(topic)
    ? getCompanyModePromptContext(dbUser?.last_company_mode)
    : '';

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
  const systemPrompt = BASE_SYSTEM_PROMPT + onboardingContext + dafContext + companyModeContext + memoryContext + weakAreaContext + adaptiveContext;

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

  // Every response is cacheable. Personalised responses are bucketed per-user
  // with a short TTL so retries are deduplicated without leaking context.
  const personalised = !!(memoryContext || weakAreaContext || adaptiveContext || onboardingContext || dafContext || companyModeContext);
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
