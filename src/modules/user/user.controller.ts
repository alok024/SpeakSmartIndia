import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { db } from '../../core/database/client';
import { getWeakAreasForUser } from '../analytics/weak_areas.service';
import { getReadinessLabel } from '../ai/scoring';
import { PLAN_LIMITS, PlanType } from '../../core/config/env';
import { getOrCreateReferralCode } from '../growth/referral.service';

// GET /api/me
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [dbUser, usage, stats, weakAreas] = await Promise.all([
    db.getUserById(userId),
    db.getUsage(userId),
    db.getStats(userId),
    getWeakAreasForUser(userId),
  ]);

  if (!dbUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const plan          = dbUser.plan as PlanType;
  const limit         = PLAN_LIMITS[plan].ai_calls;
  const callCount     = usage?.call_count || 0;
  const jobReadyScore = stats?.avg_job_ready_score || 0;
  const readiness     = getReadinessLabel(jobReadyScore);

  res.json({
    user: {
      id:    dbUser.id,
      email: dbUser.email,
      plan:  dbUser.plan,
      name:  dbUser.name || '',
    },
    usage: {
      ai_calls:  callCount,
      limit:     limit === -1 ? null : limit,
      remaining: limit === -1 ? null : Math.max(0, limit - callCount),
    },
    stats: {
      streak:              stats?.streak     || 0,
      sessions:            stats?.sessions   || 0,
      best_score:          stats?.best_score || 0,
      avg_score: stats?.sessions
        ? Math.round((stats.total_score / stats.sessions) * 10) / 10
        : 0,
      avg_job_ready_score: jobReadyScore,
    },
    job_readiness: {
      score:   jobReadyScore,
      label:   readiness.label,
      color:   readiness.color,
      message: readiness.message,
    },
    weak_areas: weakAreas,
  });
});

// GET /api/referral
export const getReferral = asyncHandler(async (req: Request, res: Response) => {
  const info = await getOrCreateReferralCode(req.user!.id);
  res.json(info);
});
