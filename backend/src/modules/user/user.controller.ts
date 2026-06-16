import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { getUserProfile, saveOnboarding as saveOnboardingForUser } from './user.service';
import { getWeakAreasForUser } from '../analytics/weak_areas.service';
import { getOrCreateReferralCode } from '../growth/referral.service';
import { trackEvent } from '../analytics/events.service';
import { getSessionDefaults, getDashboardRecommendations } from '../ai/onboarding-context';
import { ok, notFound } from '../../core/utils/response';

// GET /api/me
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [profile, weakAreas, referralInfo] = await Promise.all([
    getUserProfile(userId),
    getWeakAreasForUser(userId),
    getOrCreateReferralCode(userId).catch(() => null),  // non-fatal — never breaks /api/me
  ]);

  if (!profile) {
    notFound(res, 'User not found');
    return;
  }

  const { dbUser, stats, limit, callCount, jobReadyScore, readiness, onboarding } = profile;

  // Derive session defaults from onboarding data — pre-fills the session
  // start screen so the user doesn't have to configure anything.
  const sessionDefaults = getSessionDefaults(
    { profession: onboarding.profession, goal: onboarding.goal },
    stats?.sessions ?? 0
  );

  // Personalised next-step recommendations for the dashboard
  const recommendations = getDashboardRecommendations(
    { profession: onboarding.profession, goal: onboarding.goal },
    {
      sessions:      stats?.sessions            ?? 0,
      best_score:    stats?.best_score          ?? 0,
      avg_job_ready: stats?.avg_job_ready_score ?? 0,
    }
  );

  // Track that the user viewed their referral info — helps measure
  // how often the share UI is surfaced vs how often it converts.
  if (referralInfo) {
    trackEvent({
      event:  'referral_viewed',
      userId,
      plan:   dbUser.plan,
      properties: {
        code:     referralInfo.code,
        uses:     referralInfo.uses,
        rewarded: referralInfo.rewarded,
      },
    });
  }

  ok(res, {
    user: {
      id:    dbUser.id,
      email: dbUser.email,
      plan:  dbUser.plan,
      name:  dbUser.name || '',
    },
    onboarding,
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
    weak_areas:       weakAreas,
    session_defaults: sessionDefaults,
    recommendations,
    // Referral info included in every /api/me response so share buttons
    // and invite flows have everything they need without a second request.
    referral: referralInfo,
  });
});

// GET /api/referral
export const getReferral = asyncHandler(async (req: Request, res: Response) => {
  const info = await getOrCreateReferralCode(req.user!.id);
  ok(res, info);
});

// POST /api/onboarding
export const saveOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const { profession, goal } = req.body as { profession: string; goal: string };
  await saveOnboardingForUser(req.user!.id, profession, goal);
  ok(res, {});
});
