/**
 * User Service
 *
 * Issue 6 fix: user.controller.ts previously called db.getUserById(),
 * db.getUsage(), db.getStats() directly, and ai.controller.ts called
 * db.incrementUsage() directly in 3 places. Both now go through this
 * service, keeping the controllers as thin request/response adapters.
 */

import { db, UserRow, UsageRow, StatsRow } from '../../core/database/client';
import { getReadinessLabel } from '../ai/scoring';
import { PLAN_LIMITS, PlanType } from '../../core/config/env';
import { logger } from '../../infra/logger';

const log = logger.child({ module: 'user' });

// Types

export interface OnboardingInfo {
  completed:  boolean;
  profession: string | null;
  goal:       string | null;
}

export interface UserProfile {
  dbUser:        UserRow;
  usage:         UsageRow | null;
  stats:         StatsRow | null;
  plan:          PlanType;
  limit:         number;
  callCount:     number;
  jobReadyScore: number;
  readiness:     ReturnType<typeof getReadinessLabel>;
  onboarding:    OnboardingInfo;
}

// Profile lookup
//
// Fetches the user row, usage row, and stats row in parallel and
// derives the plan/limit/usage/readiness/onboarding fields shared by
// GET /api/me and other consumers. Returns null if the user no longer
// exists (e.g. deleted between auth and request handling).

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const [dbUser, usage, stats] = await Promise.all([
    db.getUserById(userId),
    db.getUsage(userId),
    db.getStats(userId),
  ]);

  if (!dbUser) return null;

  const plan          = dbUser.plan as PlanType;
  const baseLimit     = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).ai_calls;
  // Fix: Include referral bonus calls in the limit so /api/me's
  // usage.limit matches what checkUsageLimit middleware enforces.
  // Previously getUserProfile returned the raw PLAN_LIMITS value (7 for
  // free) while the middleware correctly added referral_bonus — meaning
  // the dashboard always showed "7" even for users who earned bonus calls,
  // and the "X of Y free used" bar was misleading / wrong.
  const bonusCalls    = dbUser.referral_bonus ?? 0;
  const limit         = baseLimit === -1 ? -1 : baseLimit + bonusCalls;
  const callCount     = usage?.call_count || 0;
  const jobReadyScore = stats?.avg_job_ready_score || 0;
  const readiness     = getReadinessLabel(jobReadyScore);

  const onboarding: OnboardingInfo = {
    completed:  !!dbUser.onboarding_completed_at,
    profession: dbUser.onboarding_profession || null,
    goal:       dbUser.onboarding_goal || null,
  };

  return { dbUser, usage, stats, plan, limit, callCount, jobReadyScore, readiness, onboarding };
}

// Onboarding

export async function saveOnboarding(userId: string, profession: string, goal: string): Promise<void> {
  await db.saveOnboarding(userId, profession, goal);
}

// AI usage
//
// Wraps db.incrementUsage with the same non-fatal error handling that
// was previously duplicated across handleAI / handleAIStream (3 call
// sites in ai.controller.ts). A failed usage increment must never fail
// the AI response — it's logged and swallowed here.

export async function incrementAIUsage(userId: string): Promise<void> {
  try {
    await db.incrementUsage(userId);
  } catch (err) {
    log.error('incrementUsage failed (non-fatal)', { userId, error: (err as Error).message });
  }
}
