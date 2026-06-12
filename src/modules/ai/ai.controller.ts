/**
 * AI Controller — Phase 9
 *
 * Phase 8 → 9 additions:
 *   1. System-level load check (RPM gate) before burst check
 *   2. Adaptive behavior context injected into system prompt (Pro/Elite)
 *   3. Structured cache context (type + topic) passed to callAI
 *   4. Sentry user context set on each request
 *   5. Metrics counter for burst rejections
 */

import { Request, Response }      from 'express';
import { asyncHandler }            from '../../core/middleware';
import { db }                      from '../../core/database/client';
import { callAI, AIMessage }       from './ai.service';
import { getUserMemoryContext }     from './ai.memory';
import { getWeakAreaPromptContext } from '../analytics/weak_areas.service';
import { getAdaptiveBehaviorContext } from './ai-adaptive';
import { PLAN_LIMITS, PlanType }   from '../../core/config/env';
import { aiLogger }                from '../../infra/logger';
import { checkBurstLimit }         from '../../infra/burst-limiter';
import { getAILimiterStats }       from '../../infra/ai-limiter';
import { checkSystemLoad }         from '../../infra/load-monitor';
import { setSentryUser, captureException, increment } from '../../infra/observability';

// ── Aria base prompt ──────────────────────────────────────────────

const BASE_SYSTEM_PROMPT =
  `You are Aria, an AI interview coach for SpeakSmart. ` +
  `Help users practice job interviews, evaluate their answers, give structured feedback, ` +
  `and improve their English communication. Only assist with interview-related tasks. ` +
  `Be concise and direct. Always respond with valid JSON when asked.`;

// ── POST /api/ai ──────────────────────────────────────────────────

export const handleAI = asyncHandler(async (req: Request, res: Response) => {
  const user      = req.user!;
  const callCount = req.callCount ?? 0;
  const plan      = user.plan as PlanType;
  const limit     = PLAN_LIMITS[plan]?.ai_calls ?? 30;

  const topic = (req.body.topic as string | undefined) ||
                (req.body.profession as string | undefined) ||
                'General';

  // Tag this user in Sentry for any subsequent errors
  setSentryUser(user.id, plan);

  // ── 1. System load gate (RPM cap — all users) ─────────────────
  const load = checkSystemLoad();
  if (load.overloaded) {
    res.setHeader('Retry-After', '30');
    res.status(503).json({
      error:         'system_overloaded',
      message:       'The system is currently under heavy load. Please try again shortly.',
      retry_after_s: 30,
      rpm:           load.rpm,
      max_rpm:       load.maxRpm,
    });
    return;
  }

  // ── 2. Per-user burst check ────────────────────────────────────
  const burst = await checkBurstLimit(user.id);
  if (!burst.allowed) {
    increment('ai.burst.rejected');
    const retryAfter = Math.ceil(burst.resetInMs / 1000);
    res.setHeader('Retry-After', retryAfter);
    res.status(429).json({
      error:         'burst_limit_exceeded',
      message:       'You are sending requests too fast. Please slow down.',
      retry_after_s: retryAfter,
    });
    return;
  }

  // ── 3. Build system prompt ─────────────────────────────────────
  const hasPersonalisation = plan !== 'free';

  // Fetch all personalisation data in parallel
  const [memoryContext, weakAreaContext, userStats] = hasPersonalisation
    ? await Promise.all([
        getUserMemoryContext(user.id, topic),
        getWeakAreaPromptContext(user.id),
        db.getStats(user.id),
      ])
    : ['', '', null];

  // Adaptive coaching layer (Pro/Elite only)
  const adaptiveContext = (hasPersonalisation && userStats)
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
    : '';

  const systemPrompt = BASE_SYSTEM_PROMPT + memoryContext + weakAreaContext + adaptiveContext;

  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    ...((req.body.messages as AIMessage[]) || []),
  ];

  // Personalised prompts are not cacheable (unique memory/adaptive context per user)
  const cacheable = !hasPersonalisation;

  // ── 4. Call AI ─────────────────────────────────────────────────
  let text: string;
  let provider: string;
  let cached: boolean | undefined;

  try {
    ({ text, provider, cached } = await callAI(
      messages,
      req.body.max_tokens,
      {
        cacheable,
        cacheCtx: { topic },   // structured cache key
      }
    ));
  } catch (err) {
    const e = err as Error & { statusCode?: number; retryAfterSeconds?: number };

    captureException(e, { userId: user.id, plan, extra: { topic } });

    if (e.retryAfterSeconds) res.setHeader('Retry-After', e.retryAfterSeconds);

    res.status(e.statusCode ?? 503).json({
      error:         'ai_unavailable',
      message:       e.message,
      retry_after_s: e.retryAfterSeconds ?? 30,
      _debug: process.env.NODE_ENV === 'development' ? getAILimiterStats() : undefined,
    });
    return;
  }

  // ── 5. Increment usage ─────────────────────────────────────────
  try {
    await db.incrementUsage(user.id);
  } catch (err) {
    aiLogger.error('incrementUsage failed (non-fatal)', { userId: user.id, error: (err as Error).message });
  }

  aiLogger.debug('AI call completed', {
    userId:    user.id,
    provider,
    cached:    cached ?? false,
    callCount: callCount + 1,
    plan,
    adaptive:  !!adaptiveContext,
  });

  res.json({
    text,
    provider,
    cached:     cached ?? false,
    calls_used: callCount + 1,
    limit:      limit === -1 ? null : limit,
    remaining:  limit === -1 ? null : Math.max(0, limit - (callCount + 1)),
  });
});
