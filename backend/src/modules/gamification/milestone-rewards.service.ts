/**
 * Milestone Rewards Service
 *
 * Fires once per milestone per user — idempotent by design.  Called
 * non-fatally from sessions.service.ts after each streak increment.
 *
 * Milestones:
 *   3  days — +1 bonus session (free users only).
 *   7  days — Unlocks first streak-freeze slot. (Voice bonus at day 7 is
 *             handled by voice.ledger.ts maybeAwardStreakVoiceBonus, which
 *             fires on every 7-day interval — not double-awarded here.)
 *   14 days — +5 bonus sessions (all plans).
 *   21 days — +15 bonus voice minutes.
 *   30 days — XP double-day: all XP earned that IST calendar day counts 2×.
 *             A push notification is sent immediately at grant time.
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
import { sendFcmToUser } from '../push/push.service';

const log = logger.child({ module: 'milestone-rewards' });

// Milestone thresholds in ascending order.
// 3  days — +1 bonus session (free users only)
// 7  days — streak-freeze slot unlock (voice bonus via voice.ledger, not here)
// 14 days — +5 bonus sessions (all plans)
// 21 days — +15 bonus voice minutes (one-time; recurring voice via voice.ledger)
// 30 days — XP double-day
// 60 days — Auto-generated readiness certificate
// 90 days — 7-day Elite trial
const MILESTONES = [3, 7, 14, 21, 30, 60, 90] as const;
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
  // Pick the highest ungranted milestone at or below the current streak —
  // this also handles a streak correction jumping over a threshold (e.g. 6 → 8
  // skips 7). Lower skipped milestones remain ungranted and fire on a later call.
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
    case 3:
      return award3Day(userId, user.name ?? 'Vachix User', user.plan ?? 'free');
    case 7:
      return award7Day(userId, user.name ?? 'Vachix User');
    case 14:
      return award14Day(userId, user.name ?? 'Vachix User');
    case 21:
      return award21Day(userId, user.name ?? 'Vachix User', user.plan ?? 'free');
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

// ── 3-day: +1 bonus session (free users) ─────────────────────────────────────

async function award3Day(userId: string, name: string, plan: string): Promise<MilestoneRewardResult> {
  // Free users only — paid plans already have generous session allowances.
  if (plan === 'free') {
    try {
      await db.addBonusSessions(userId, 1);
    } catch (err) {
      log.warn('award3Day: addBonusSessions failed (non-fatal)', { userId, error: String(err) });
    }
  }

  await sendPush(userId, {
    title: '🔥 3-Day Streak!',
    body:  plan === 'free'
      ? `${name}, you've earned a bonus session. Keep it going!`
      : `${name}, 3 days strong — you're building momentum!`,
    url:   `${env.FRONTEND_URL}/dashboard`,
  });

  return {
    milestone:   3,
    celebration: true,
    title:       '3-Day Streak!',
    body:        plan === 'free'
      ? 'You\'ve earned 1 bonus session.'
      : 'Keep the streak alive!',
  };
}

// ── 7-day: unlock first streak-freeze slot ───────────────────────────────────
// Voice bonus at day 7 is handled by voice.ledger.ts (maybeAwardStreakVoiceBonus),
// which fires on every 7-day interval [7, 14, 21, 28, ...]. Adding a separate
// topUpBonusVoiceSeconds call here would double-award on day 7.

async function award7Day(userId: string, name: string): Promise<MilestoneRewardResult> {
  // streak_freeze_unlocked is already flipped by increment_user_stats at
  // the 7-day threshold (migration 024). Send a push to celebrate and
  // surface the unlock in the dashboard.
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

// ── 14-day: +5 bonus sessions ────────────────────────────────────────────────

async function award14Day(userId: string, name: string): Promise<MilestoneRewardResult> {
  try {
    await db.addBonusSessions(userId, 5);
  } catch (err) {
    log.warn('award14Day: addBonusSessions failed (non-fatal)', { userId, error: String(err) });
  }

  await sendPush(userId, {
    title: '🌟 14-Day Streak! Bonus sessions unlocked',
    body:  `${name}, two weeks straight — you've earned 5 bonus sessions this month!`,
    url:   `${env.FRONTEND_URL}/dashboard`,
  });

  return {
    milestone:   14,
    celebration: true,
    title:       '14-Day Streak!',
    body:        '5 bonus sessions added to your monthly allowance.',
  };
}

// ── 21-day: +15 bonus voice minutes ──────────────────────────────────────────
// NOTE: The master plan also defines a 5-min avatar taste for Starter users at
// this milestone, but the avatar bonus top-up RPC is scheduled for Phase 4.
// The voice bonus is delivered here; the avatar credit will be wired in Phase 4.

async function award21Day(userId: string, name: string, plan: string): Promise<MilestoneRewardResult> {
  const VOICE_BONUS_SECS = 900; // 15 min
  try {
    await db.topUpBonusVoiceSeconds(userId, VOICE_BONUS_SECS, env.MAX_BONUS_VOICE_SECONDS);
  } catch (err) {
    log.warn('award21Day: topUpBonusVoiceSeconds failed (non-fatal)', { userId, error: String(err) });
  }

  await sendPush(userId, {
    title: '🚀 21-Day Streak! Voice minutes bonus',
    body:  `${name}, 21 days — incredible! You've earned 15 bonus voice minutes.`,
    url:   `${env.FRONTEND_URL}/dashboard`,
  });

  return {
    milestone:   21,
    celebration: true,
    title:       '21-Day Streak!',
    body:        `15 bonus voice minutes added${plan === 'starter' ? ' (avatar taste coming soon).' : '.'}`,
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
  // Mints a streak-specific certificate token; certificates.service.ts
  // recognizes the 'streak60' kind and renders it as a streak certificate
  // rather than a session-count one.
  const token   = encodeCertificateToken({ kind: 'streak60', userId });
  const certUrl = `${env.FRONTEND_URL}/certificate/${token}`;

  // Store the cert URL on the user row so the dashboard can surface it.
  await db.updateUser(userId, { streak60_cert_url: certUrl });

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
  await Promise.allSettled([
    sendWebPush(userId, payload),
    sendFcmToUser(userId, payload),
  ]);
}

async function sendWebPush(
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
    log.warn('sendWebPush failed (milestone reward, non-fatal)', { userId, error: String(err) });
  }
}
