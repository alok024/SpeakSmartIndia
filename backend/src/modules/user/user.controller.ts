import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { getUserProfile, saveOnboarding as saveOnboardingForUser } from './user.service';
import { getWeakAreasForUser } from '../analytics/weak_areas.service';
import { getOrCreateReferralCode } from '../growth/referral.service';
import { trackEvent } from '../analytics/events.service';
import { getSessionDefaults, getDashboardRecommendations } from '../ai/onboarding-context';
import { ok, notFound } from '../../core/utils/response';
import { SESSION_CAP_FREE, SESSION_CAP_STARTER } from '../../core/config/env';
import { db } from '../../core/database/client';

// GET /api/me
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [profile, weakAreas, referralInfo, activeSub] = await Promise.all([
    getUserProfile(userId),
    getWeakAreasForUser(userId),
    getOrCreateReferralCode(userId).catch(() => null),  // non-fatal — never breaks /api/me
    db.getActiveSubscription(userId).catch(() => null), // non-fatal — billing info for profile UI
  ]);

  if (!profile) {
    notFound(res, 'User not found');
    return;
  }

  const { dbUser, usage, stats, limit, callCount, jobReadyScore, readiness, onboarding } = profile;

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
      // These four were previously omitted here, even though the frontend's
      // User type (and ProtectedRoute's onboarding/admin gates) expect them
      // on the user object. Without onboarding_completed_at and created_at,
      // EVERY free-plan user — including ones who'd already finished
      // onboarding — looked permanently un-onboarded and pre-launch-exempt
      // checks could never pass, so ProtectedRoute redirected to
      // /profile?onboarding=1 on first load and again on every subsequent
      // navigation (the useEffect re-runs on each pathname change and the
      // same stale/missing data was there every time). Without is_admin,
      // requireAdmin pages always bounced real admins back to /dashboard.
      email_verified:           dbUser.email_verified ?? false,
      onboarding_completed_at:  dbUser.onboarding_completed_at ?? null,
      is_admin:                 dbUser.is_admin ?? false,
      created_at:               dbUser.created_at,
      // Job-landed fields — needed by dashboard to hide the "I got the job"
      // card once the user has already submitted, and by the OG share panel.
      // Null-coalesced so pre-migration rows (column not yet present) are
      // safe: the dashboard's `!job_landed_at` guard will evaluate cleanly.
      job_landed_at:            dbUser.job_landed_at      ?? null,
      job_landed_role:          dbUser.job_landed_role    ?? null,
      job_landed_company:       dbUser.job_landed_company ?? null,
      // Migration 019: HD voice preference. Always false for free users (no paid TTS).
      hd_voice_enabled:         dbUser.plan === 'free' ? false : (dbUser.hd_voice_enabled ?? false),
    },
    onboarding,
    usage: {
      ai_calls:  callCount,
      limit:     limit === -1 ? null : limit,
      remaining: limit === -1 ? null : Math.max(0, limit - callCount),
      resets_at: limit === -1 ? null : (() => {
        // First day of next IST month — tells the frontend when the cap resets.
        // Computed server-side so the client doesn't need to know timezone logic.
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const nextMonth = new Date(nowIST.getFullYear(), nowIST.getMonth() + 1, 1);
        return nextMonth.toISOString();
      })(),
      // P1-A + Migration 025: monthly session cap.
      // Free:    capped at SESSION_CAP_FREE (3).
      // Starter: capped at SESSION_CAP_STARTER (30) + monthly_session_bonus.
      // Pro / Elite: no cap → null.
      // Previously used `limit === -1` (ai_calls unlimited) as proxy for
      // "paid plan", which wrongly gave Starter a session_limit of 3.
      session_count:   usage?.monthly_session_count   ?? 0,
      session_bonus:   usage?.monthly_session_bonus   ?? 0,
      session_limit:   dbUser.plan === 'free'
        ? SESSION_CAP_FREE
        : dbUser.plan === 'starter'
          ? SESSION_CAP_STARTER + (usage?.monthly_session_bonus ?? 0)
          : null,
    },
    stats: {
      streak:              stats?.streak     || 0,
      sessions:            stats?.sessions   || 0,
      best_score:          stats?.best_score || 0,
      avg_score: stats?.sessions
        ? Math.round((stats.total_score / stats.sessions) * 10) / 10
        : 0,
      avg_job_ready_score: jobReadyScore,
      // Migration 023: XP system
      xp_lifetime:         stats?.xp_lifetime ?? 0,
      xp_monthly:          stats?.xp_monthly  ?? 0,
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
    // Active subscription billing info — used by the profile page to show
    // renewal date and cancellation instructions. Null for free plan users.
    subscription: activeSub ? {
      plan:       activeSub.plan,
      status:     activeSub.status,
      started_at: activeSub.started_at,
      expires_at: activeSub.expires_at,
    } : null,
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
  trackEvent({ event: 'onboarding_complete', userId: req.user!.id, plan: req.user!.plan, properties: { profession, goal } });
  ok(res, {});
});

// POST /api/daf
//
// Saves (or updates) the user's UPSC DAF profile. All fields are optional
// so the frontend can auto-save partial forms without waiting for completion.
// The AI prompt layer skips null fields, so a partial DAF still improves
// question personalisation for whichever fields are populated.

export const saveDAF = asyncHandler(async (req: Request, res: Response) => {
  const fields = req.body as {
    name?:               string | null;
    home_state?:         string | null;
    graduation_subject?: string | null;
    graduation_college?: string | null;
    optional_subject?:   string | null;
    hobbies?:            string | null;
    work_experience?:    string | null;
    extracurriculars?:   string | null;
  };
  await db.saveDAF(req.user!.id, fields);
  trackEvent({ event: 'daf_saved', userId: req.user!.id, plan: req.user!.plan, properties: {} });
  ok(res, {});
});

// GET /api/daf
//
// Returns the user's current DAF profile so the profile page can pre-fill
// the form on load.

export const getDAF = asyncHandler(async (req: Request, res: Response) => {
  const user = await db.getUserById(req.user!.id);
  if (!user) { notFound(res, 'User not found'); return; }
  ok(res, {
    name:               user.daf_name               ?? null,
    home_state:         user.daf_home_state         ?? null,
    graduation_subject: user.daf_graduation_subject ?? null,
    graduation_college: user.daf_graduation_college ?? null,
    optional_subject:   user.daf_optional_subject   ?? null,
    hobbies:            user.daf_hobbies            ?? null,
    work_experience:    user.daf_work_experience    ?? null,
    extracurriculars:   user.daf_extracurriculars   ?? null,
  });
});

// POST /api/company-mode
//
// Persists the user's last-selected company target. Null clears it.
// The frontend also stores this in the interview config store for the
// current session — this endpoint is just for cross-session persistence.

export const saveCompanyMode = asyncHandler(async (req: Request, res: Response) => {
  const { company_mode } = req.body as { company_mode: string | null };
  await db.saveCompanyMode(req.user!.id, company_mode);
  ok(res, {});
});

