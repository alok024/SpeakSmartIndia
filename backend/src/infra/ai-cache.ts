/**
 * AI Response Cache — Phase 9
 *
 * Phase 8 problems:
 *   1. Key = hash(full messages array) — one character change = total miss.
 *      No way to invalidate by topic, type, or role without a full flush.
 *   2. No invalidation API — stale data lives until TTL expires.
 *
 * Phase 9 fixes:
 *
 * ── Structured key: ai:cache:<type>:<topic>:<hash> ───────────────
 *   type  = 'interview' | 'feedback' | 'tip' | 'general'
 *           (inferred from the last user message)
 *   topic = normalized topic slug  (e.g. "software-engineering")
 *   hash  = SHA-256 of only the user/assistant turn content
 *           (system prompt excluded — it changes per user)
 *
 * This lets you do targeted invalidation:
 *   invalidateCacheByTopic('software-engineering') → deletes all
 *   keys matching ai:cache:*:software-engineering:*
 *
 * ── Partial invalidation API ──────────────────────────────────────
 *   invalidateCacheByTopic(topic)  — when topic content changes
 *   invalidateCacheByType(type)    — e.g. flush all 'tip' prompts
 *   invalidateCacheAll()           — nuclear option
 *
 * ── TTL by type ───────────────────────────────────────────────────
 *   interview → 10 min  (contextual, changes often)
 *   feedback  → 15 min  (semi-stable)
 *   tip       → 60 min  (generic advice — very cache-friendly)
 *   general   → 10 min
 *   personalised (any type, M2) → 3 min, bucketed per-user
 *
 * ── System prompt excluded from hash ──────────────────────────────
 *   The system prompt contains injected memory/weak-area context that
 *   is unique per user. Hashing it would make every key unique even
 *   for identical user questions. M2: personalised responses are now
 *   cached too, just bucketed by userId (via ctx.userId) with a short
 *   TTL — see PERSONALISED_TTL — instead of being skipped entirely.
 *
 * Config (env):
 *   AI_CACHE_TTL_SECONDS  — overrides all type TTLs if set (default: per-type)
 */

import { createHash }  from 'crypto';
import { env }         from '../core/config/env';
import { getRedis }    from './queue/redis';
import { logger }      from './logger';

const log    = logger.child({ module: 'ai-cache' });
const PREFIX = 'ai:cache';

// ── TTL by call type (seconds) ────────────────────────────────────

type CacheType = 'interview' | 'feedback' | 'tip' | 'general';

const DEFAULT_TTL: Record<CacheType, number> = {
  interview: 600,   // 10 min
  feedback:  900,   // 15 min
  tip:       3600,  // 60 min
  general:   600,
};

const GLOBAL_TTL = env.AI_CACHE_TTL_SECONDS ?? null;

// M2: short TTL for personalised (per-user) cache entries — long enough to
// dedupe rapid retries/reconnects, short enough that stale memory/weak-area/
// adaptive context never lingers noticeably.
const PERSONALISED_TTL = 180; // 3 min

function ttlFor(type: CacheType, personalised: boolean): number {
  if (personalised) return GLOBAL_TTL ?? PERSONALISED_TTL;
  return GLOBAL_TTL ?? DEFAULT_TTL[type];
}

// ── Key derivation ────────────────────────────────────────────────

export interface CacheContext {
  type?:       CacheType;
  topic?:      string;
  /**
   * Coarse, non-PII personalisation bucket (e.g. "software:get_job").
   * Included in the cache key so cached responses stay aligned with a
   * user's onboarding profile instead of silently overwriting
   * personalisation on a cache hit.
   */
  personaKey?: string;
  /**
   * M2: true when the system prompt was personalised (memory / weak-area /
   * adaptive / onboarding context injected). Previously such responses were
   * never cached at all — meaning paying (Pro/Elite) users, who are the
   * ones most likely to have this context, got zero cache benefit.
   *
   * Now personalised responses ARE cached, but bucketed per-user (see
   * `userId` below) with a short TTL — see PERSONALISED_TTL — so a quick
   * retry/reconnect is deduplicated without serving one user's coaching
   * context to another, and without context going stale for long.
   */
  personalised?: boolean;
  /** Required when personalised=true — scopes the cache key to this user. */
  userId?: string;
}

/** Infer call type from the last user message content */
function inferType(messages: Array<{ role: string; content: string }>): CacheType {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return 'general';
  const c = lastUser.content.toLowerCase();
  if (c.includes('tip') || c.includes('advice') || c.includes('suggest'))  return 'tip';
  if (c.includes('feedback') || c.includes('evaluate') || c.includes('score')) return 'feedback';
  if (c.includes('question') || c.includes('interview') || c.includes('answer')) return 'interview';
  return 'general';
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/**
 * Build a structured cache key.
 * Only non-system messages contribute to the hash — system prompts are
 * per-user and must not pollute shared cache buckets.
 */
function buildKey(
  messages: Array<{ role: string; content: string }>,
  ctx: CacheContext
): { key: string; type: CacheType; topic: string; personalised: boolean } {
  const type   = ctx.type  ?? inferType(messages);
  const topic  = slugify(ctx.topic ?? 'general');
  const persona = ctx.personaKey ? `:${slugify(ctx.personaKey)}` : '';

  // M2: personalised responses are bucketed per-user so cached coaching
  // context for one user is never served to another.
  const personalised = !!ctx.personalised;
  const userSegment  = personalised && ctx.userId ? `:u${slugify(ctx.userId)}` : '';

  const turns = messages.filter(m => m.role !== 'system');
  const hash  = createHash('sha256')
    .update(JSON.stringify(turns))
    .digest('hex')
    .slice(0, 40); // 40 hex chars — collision-safe, readable in Redis

  return { key: `${PREFIX}:${type}:${topic}${persona}${userSegment}:${hash}`, type, topic, personalised };
}

// ── Types ─────────────────────────────────────────────────────────

export interface CachedAIResponse {
  text:     string;
  provider: 'groq' | 'openai_fallback';
}

// ── Read ──────────────────────────────────────────────────────────

export async function getCachedAIResponse(
  messages: Array<{ role: string; content: string }>,
  ctx: CacheContext = {}
): Promise<CachedAIResponse | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const { key, type, topic, personalised } = buildKey(messages, ctx);
    const raw = await redis.get(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedAIResponse & { _cachedAt?: string };
    log.debug('AI cache hit', { type, topic, personalised, cachedAt: parsed._cachedAt });
    return { text: parsed.text, provider: parsed.provider };
  } catch (err) {
    log.warn('AI cache GET failed — proceeding without cache', { error: (err as Error).message });
    return null;
  }
}

// ── Write ─────────────────────────────────────────────────────────

export async function setCachedAIResponse(
  messages:  Array<{ role: string; content: string }>,
  response:  CachedAIResponse,
  ctx:       CacheContext = {}
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const { key, type, personalised } = buildKey(messages, ctx);
    const payload = JSON.stringify({ ...response, _cachedAt: new Date().toISOString() });
    await redis.set(key, payload, 'EX', ttlFor(type, personalised));
    log.debug('AI response cached', { type, personalised, ttl: ttlFor(type, personalised) });
  } catch (err) {
    log.warn('AI cache SET failed — continuing', { error: (err as Error).message });
  }
}

// ── Partial invalidation ──────────────────────────────────────────

/**
 * Delete all cached responses for a given topic.
 * Use when topic-specific content (questions, tips) changes.
 *
 * Pattern: ai:cache:*:<topic>:*
 * Uses SCAN — never KEYS — so it's safe on large Redis instances.
 */
export async function invalidateCacheByTopic(topic: string): Promise<number> {
  return _scanDelete(`${PREFIX}:*:${slugify(topic)}:*`);
}

/**
 * Delete all cached responses for a given call type.
 * Use when prompt templates change (e.g. you updated the tip prompt).
 */
export async function invalidateCacheByType(type: CacheType): Promise<number> {
  return _scanDelete(`${PREFIX}:${type}:*`);
}

/** Nuclear option — flush the entire AI cache. */
export async function invalidateCacheAll(): Promise<number> {
  return _scanDelete(`${PREFIX}:*`);
}

/** SCAN + DEL in batches of 100. Returns count of deleted keys. */
async function _scanDelete(pattern: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  let cursor = '0';
  let deleted = 0;

  try {
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== '0');

    log.info('Cache invalidated', { pattern, deleted });
    return deleted;
  } catch (err) {
    log.warn('Cache invalidation failed', { pattern, error: (err as Error).message });
    return 0;
  }
}
