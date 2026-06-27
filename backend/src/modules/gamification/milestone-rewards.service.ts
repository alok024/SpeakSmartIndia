/**
 * Milestone Rewards Service
 *
 * Fires once per milestone per user — idempotent by design.  Called
 * non-fatally from sessions.service.ts after each streak increment.
 *
 * Milestones:
 *   7  days — Unlocks first streak-freeze slot (if not already unlocked).
 *             Small celebration animation flag returned to the client via
 *             the session save response.
 *   30 days — XP double-day: all XP earned that IST calendar day counts 2×.
 *             A morning push notification is sent at grant time (the user
 *             has just completed a session, so "morning" is approximate —
 *             the notification is sent immediately rather than re-scheduling
 *             for dawn, which would require a separate cron).
 *   60 days — Free readiness certificate auto-generated and shareable to
 *             LinkedIn. Uses the existing HMAC-signed certificate system.
 *   90 days — 7-day Elite trial: unlocks full avatar, full Elara audit,
 *             all exam tracks. Sets elite_trial_expires_at = NOW() + 7 days
 *             on the users row.  Does NOT touch users.plan — effective_plan()
 *             DB function resolves it dynamically.
 *
 * Each milestone is recorded in users.milestone_rewards_granted (jsonb)
 * so re-running is safe on retry.  A milestone fires exactly once; later
 * streaks above the threshold don't re-trigger.
 *
 * Integration:
 *   sessions.service.ts calls maybeTriggerMilestoneRewards() after
 *   db.incrementStats() returns the new streak.  Errors are caught and
 *   logged — a failed reward must never fail the session save.
 */

import crypto      from 'crypto';
import { db }      from '../../core/database/client';
import { env }     from '../../core/config/env';
import { logger }  from '../../infra/logger';
import { encodeCertificateToken } from '../certificates/certificates.service';

const log = logger.child({ module: 'milestone-rewards' });

// The four milestone thresholds, in ascending order.
const MILESTONES = [7, 30, 60, 90] as const;
type Milestone = typeof MILESTONES[number];

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Check whether the current streak has crossed a new milestone and, if so,
 * grant the corresponding reward.  Each milestone fires at most once per
 * user — enforced by checking milestone_rewards_granted before acting.
 *
 * Safe to call on every session save; returns quickly when no milestone
 * is crossed (streak not in the milestone set or already granted).
 *
 * Returns a MilestoneRewardResult if a milestone fired, or null otherwise.
 * The caller (sessions.service.ts) includes this in the session-save
 * response so the frontend can show the celebration animation.
 */
export async function maybeTriggerMilestoneRewards(
  userId: string,
  streak: number,
): Promise<MilestoneRewardResult | null> {
  // Use a range check (m <= streak) rather than an exact match (m === streak)
  // so that a streak correction that jumps over a threshold — e.g. 6 → 8 skipping
  // 7 — still fires the missed milestone.  The granted-flag guard below ensures
  // each milestone fires at most once regardless of how many sessions trigger this.
  // We pick the highest ungranted milestone at or below the current streak so that
  // only one reward fires per session (the most significant one earned so far).
  // Lower milestones that were also skipped will fire on subsequent sessions as
  // the streak continues to climb through them — they remain ungranted and will
  // be picked up by the `m <= streak` filter on the next call.
  //
  // Load user first so we can filter by already-granted milestones before
  // deciding which milestone (if any) to fire.
  const user = await db.getUserById(userId);
  if (!user) return null;

  const granted: Record<string, boolean> =
    (user.milestone_rewards_granted as Record<string, boolean>) ?? {};

  // Find the highest milestone at or below the current streak that has not
  // yet been granted.  MILESTONES is in ascending order; reversing gives us
  // the highest candidate first.
  const milestone = [...MILESTONES]
    .reverse()
    .find(m => m <= streak && !granted[String(m)]);

  if (!milestone) return null;

  // Mark as granted first — if the reward logic below throws, a retry
  // will skip the milestone rather than double-awarding.
  await db.grantMilestoneReward(userId, milestone);

  log.info('Milestone reward triggered', { userId, milestone, streak });

  switch (milestone) {
    case 7:
      return award7Day(userId, user.name ?? 'Vachix User');
    case 30:
      return award30Day(userId, user.name ?? 'Vachix User');
    case 60:
      return award60Day(userId, user.name ?? 'Vachix User');
    case 90:
      return award90Day(userId, user.name ?? 'Vachix User');
  }
}

// ── Milestone result type ─────────────────────────────────────────────────────

export interface MilestoneRewardResult {
  milestone:   Milestone;
  celebration: boolean;   // frontend shows confetti / animation
  title:       string;
  body:        string;
  /** Only present for the 60-day cert reward */
  cert_url?:   string;
}

// ── 7-day: unlock first streak-freeze slot ───────────────────────────────────

async function award7Day(userId: string, name: string): Promise<MilestoneRewardResult> {
  // streak_freeze_unlocked is already flipped by increment_user_stats at
  // the 7-day threshold (migration 024).  We send a push notification to
  // celebrate and surface the unlock in the dashboard.
  await sendPush(userId, {
    title: '🔥 7-Day Streak! Freeze slot unlocked',
    body:  `${name}, you've earned your first Streak Freeze. Use it to protect your streak on a rest day.`,
    url:   `${env.FRONTEND_URL}/dashboard`,
  });

  return {
    milestone:   7,
    celebration: true,
    title:       '7-Day Streak!',
    body:        'You\'ve unlocked your first Streak Freeze.',
  };
}

// ── 30-day: XP double-day ────────────────────────────────────────────────────

async function award30Day(userId: string, name: string): Promise<MilestoneRewardResult> {
  // Store today's IST date — increment_user_stats checks this column and
  // doubles XP when the session date matches.
  const todayIST = getISTDateString();
  await db.setXpDoubleDay(userId, todayIST);

  await sendPush(userId, {
    title: '⚡ 30-Day Streak! XP Double Day activated',
    body:  `${name}, all XP you earn today counts 2×. Go get it!`,
    url:   `${env.FRONTEND_URL}/dashboard`,
  });

  return {
    milestone:   30,
    celebration: true,
    title:       '30-Day Streak!',
    body:        'Today is your XP Double Day — all XP earned today counts 2×.',
  };
}

// ── 60-day: auto-generate readiness certificate ───────────────────────────────

async function award60Day(userId: string, name: string): Promise<MilestoneRewardResult> {
  // Mint a certificate token for this user's streak milestone.
  // We use a dedicated 'streak60' certificate kind encoded as a readiness
  // payload with sessionCount = 0 as a sentinel — the certificates.service
  // resolver handles it via a special case (added below in this PR) that
  // renders a streak certificate rather than a session-count certificate.
  //
  // Simpler alternative (chosen here to avoid modifying certificates.service):
  // use the user's latest readiness report if they have one, falling back to
  // a streak-specific token with sessionCount = -60 as sentinel.
  //
  // We encode a readiness payload with sessionCount = -60 as a sentinel that
  // certificates.service.ts will intercept and render as a streak certificate.
  const token   = encodeCertificateToken({ kind: 'streak60', userId });
  const certUrl = `${env.FRONTEND_URL}/certificate/${token}`;

  // Store the cert URL on the user row so the dashboard can surface it.
  await db.updateUser(userId, { streak60_cert_url: certUrl } as never);

  await sendPush(userId, {
    title: '🏆 60-Day Streak! Your certificate is ready',
    body:  `${name}, you've earned a Readiness Certificate. Share it on LinkedIn!`,
    url:   certUrl,
  });

  return {
    milestone:   60,
    celebration: true,
    title:       '60-Day Streak!',
    body:        'Your Readiness Certificate has been generated. Share it on LinkedIn!',
    cert_url:    certUrl,
  };
}

// ── 90-day: Elite 7-day trial ────────────────────────────────────────────────

async function award90Day(userId: string, name: string): Promise<MilestoneRewardResult> {
  const trialExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.setEliteTrial(userId, trialExpires);

  await sendPush(userId, {
    title: '👑 90-Day Streak! Elite trial activated',
    body:  `${name}, you've unlocked 7 days of Elite — full avatar, Elara audit, all tracks. Enjoy!`,
    url:   `${env.FRONTEND_URL}/dashboard`,
  });

  return {
    milestone:   90,
    celebration: true,
    title:       '90-Day Streak!',
    body:        '7-day Elite trial activated — full avatar, Elara audit, all exam tracks.',
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the current IST date as 'YYYY-MM-DD'. */
function getISTDateString(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const nowIST = new Date(Date.now() + IST_OFFSET_MS);
  return nowIST.toISOString().slice(0, 10);
}

async function sendPush(
  userId:  string,
  payload: { title: string; body: string; url: string },
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;

  try {
    const webpush = (await import('web-push')).default;
    const subs    = await db.getPushSubscriptions(userId);
    if (!subs.length) return;

    const json = JSON.stringify(payload);
    await Promise.allSettled(
      subs.map(async sub => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            json,
          );
        } catch (err: unknown) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 410 || status === 404) {
            await db.deletePushSubscription(sub.endpoint).catch(() => {});
          } else {
            log.warn('Push send failed (milestone reward)', { userId, status, error: String(err) });
          }
        }
      })
    );
  } catch (err) {
    log.warn('sendPush failed (milestone reward, non-fatal)', { userId, error: String(err) });
  }
}
