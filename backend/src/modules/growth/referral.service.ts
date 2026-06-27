/**
 * Referral Service
 *
 * Implements the invite-a-friend referral loop: code generation, attribution
 * at signup, and reward crediting on the referred user's first session.
 *
 * Flow:
 *   1. User gets a unique referral code (generated on first request).
 *   2. New user signs up with ?ref=CODE → code is attributed.
 *   3. When referred user completes their FIRST session → referrer gets reward.
 *      (Trigger: first session completion, NOT just signup — prevents spam.)
 *   4. Reward: plan-keyed bonus sessions credited to the referrer's current
 *      month pool (usage.monthly_session_bonus). Does not roll over.
 *      Free → +1 · Starter → +2 · Pro → +5 · Elite → +10
 *
 * DB schema additions (migration 003, updated migration 025)
 *   users table:
 *     referral_code    TEXT UNIQUE  — this user's shareable code
 *     referred_by      TEXT         — code used at signup
 *
 *   referral_events table:
 *     id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
 *     referrer_id      UUID REFERENCES users(id)
 *     referred_id      UUID REFERENCES users(id)
 *     rewarded_at      TIMESTAMPTZ     — null until first session complete
 *     created_at       TIMESTAMPTZ DEFAULT now()
 *
 *   usage table (migration 025):
 *     monthly_session_bonus          INT     — bonus sessions earned this month
 *     monthly_session_bonus_reset_at TIMESTAMPTZ
 *
 * Usage
 *   // On signup (auth.service.ts):
 *   await attributeReferral(newUserId, refCode);
 *
 *   // After first session saved (sessions.service.ts):
 *   await maybeRewardReferrer(userId);
 *
 *   // In user profile endpoint:
 *   const info = await getOrCreateReferralCode(userId);
 */

import { AppError }                 from '../../core/utils/errors';
import { env, PlanType, REFERRAL_BONUS_SESSIONS } from '../../core/config/env';
import { db }                        from '../../core/database/client';
import { logger }                    from '../../infra/logger';
import crypto                        from 'crypto';

const log      = logger.child({ module: 'referral' });
const BASE_URL = env.FRONTEND_URL;

// Code generation

/** 8-char alphanumeric code — human-readable, URL-safe */
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 confusion
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[crypto.randomInt(chars.length)]; // cryptographically secure
  }
  return code;
}

// Public API

export interface ReferralInfo {
  code:            string;
  url:             string;
  uses:            number;   // how many people signed up with this code
  rewarded:        number;   // how many triggered a reward (completed first session)
  bonus_sessions:  number;   // this month's bonus sessions from referrals
  // Share context
  // Pre-built copy for share buttons, success screens, and invite flows.
  // Computed once here so no frontend template string logic is needed.
  share_context: {
    whatsapp_url:    string;   // deep-links into WhatsApp with message pre-filled
    copy_text:       string;   // plain text for "Copy link" button
    invite_headline: string;   // headline for the invite card / modal
    reward_line:     string;   // e.g. "Earn +2 bonus sessions this month"
  };
}

/**
 * Get (or create) the referral code for a user.
 * Safe to call on every profile page load — idempotent.
 */
export async function getOrCreateReferralCode(userId: string): Promise<ReferralInfo> {
  const user = await db.getUserById(userId);
  if (!user) throw new AppError(404, 'not_found', 'User not found');

  let code: string = ((user as unknown) as Record<string, string>).referral_code ?? '';

  if (!code) {
    // Generate a unique code (retry on collision)
    let attempts = 0;
    while (attempts < 5) {
      const candidate = generateCode();
      try {
        await db.setReferralCode(userId, candidate);
        code = candidate;
        break;
      } catch {
        attempts++;
      }
    }
    if (!code) throw new AppError(500, 'referral_code_generation_failed', 'Could not generate a unique referral code');
  }

  const stats   = await db.getReferralStats(userId);
  const plan    = (user.plan as PlanType) ?? 'free';
  const bonusSessions = REFERRAL_BONUS_SESSIONS[plan];

  const shareUrl  = `${BASE_URL}?ref=${code}`;
  const copyText  = `Practice for your next interview with Aria on Vachix — get real-time feedback and English corrections from Elara too. Use my link and earn +${bonusSessions} bonus interview session${bonusSessions !== 1 ? 's' : ''} this month: ${shareUrl}`;
  const waMessage = encodeURIComponent(`Hey! I've been using Vachix to prep for interviews and it's really good. Use my link — you get access and I earn +${bonusSessions} bonus sessions this month: ${shareUrl}`);

  return {
    code,
    url:            shareUrl,
    uses:           stats.uses,
    rewarded:       stats.rewarded,
    bonus_sessions: stats.bonus_sessions,
    share_context: {
      whatsapp_url:    `https://wa.me/?text=${waMessage}`,
      copy_text:       copyText,
      invite_headline: 'Invite friends, earn extra sessions',
      reward_line:     `Earn +${bonusSessions} bonus session${bonusSessions !== 1 ? 's' : ''} this month when a friend completes their first interview`,
    },
  };
}

/**
 * Called at signup when a referral code is present in the query string.
 * Records the attribution. Reward is granted later (after first session).
 */
export async function attributeReferral(
  newUserId: string,
  refCode:   string
): Promise<void> {
  if (!refCode) return;

  try {
    const referrer = await db.getUserByReferralCode(refCode);
    if (!referrer || referrer.id === newUserId) return; // invalid or self-ref

    await db.createReferralEvent(referrer.id, newUserId);
    await db.setReferredBy(newUserId, refCode);

    log.info('Referral attributed', { referrerId: referrer.id, newUserId });
  } catch (err) {
    // Referral errors must never break signup
    log.warn('Referral attribution failed (non-fatal)', { error: (err as Error).message });
  }
}

/**
 * Called after the referred user's FIRST session is saved.
 * If this user was referred, rewards their referrer with plan-keyed bonus sessions.
 * Idempotent — rewarded_at check prevents double-granting.
 *
 * Bonus amount is determined by the referrer's plan at reward time, not at
 * signup time, so upgrading before the friend completes their session earns
 * the higher tier bonus.
 */
export async function maybeRewardReferrer(userId: string): Promise<void> {
  try {
    const event = await db.getPendingReferralEvent(userId);
    if (!event) return; // not referred, or already rewarded

    // Look up referrer's current plan to determine plan-keyed bonus.
    // One extra DB read, but this path is rare (only fires once per referred user).
    const referrer     = await db.getUserById(event.referrer_id);
    const referrerPlan = (referrer?.plan as PlanType) ?? 'free';
    const bonusSessions = REFERRAL_BONUS_SESSIONS[referrerPlan];

    // Atomic upsert into usage.monthly_session_bonus via RPC (migration 025).
    // No cap param needed — the monthly reset is the natural ceiling.
    await db.addBonusSessions(event.referrer_id, bonusSessions);
    await db.markReferralRewarded(event.id);

    log.info('Referral reward granted', {
      referrerId:     event.referrer_id,
      referredId:     userId,
      referrerPlan,
      bonusSessions,
    });
  } catch (err) {
    log.warn('Referral reward failed (non-fatal)', { error: (err as Error).message });
  }
}
