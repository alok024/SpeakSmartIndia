/**
 * Voice Usage Ledger — gate-checking middleware + streak reward hook
 *
 * Migration: 011_voice_usage_ledger.sql
 *
 * Two public exports:
 *
 * 1. requireVoiceQuota (Express middleware)
 *    Gate-checks before any TTS/avatar upstream call. Reads the current
 *    month's ledger row and returns 429 if the user is at their plan cap
 *    (net of bonus seconds). Falls through to the next handler if quota
 *    remains or the check fails (fail-open, matching burst-limiter.ts).
 *
 * 2. maybeAwardStreakVoiceBonus (post-session hook)
 *    Called from sessions.service.ts when a streak milestone is hit
 *    (day 7 / 14 / 21 / 28). Credits STREAK_VOICE_BONUS_SECS to the
 *    ledger via the top_up_bonus_voice_seconds RPC. Non-fatal.
 *
 * 3. debitVoiceSeconds (post-call debit helper)
 *    Called by voice.controller.ts *after* a successful stream — so a
 *    failed upstream call never burns the user's quota. Non-fatal.
 *
 * Plan caps (configurable via env):
 *   free    — no voice (blocked upstream by requireVoiceTier in voice.routes.ts)
 *   starter — VOICE_CAP_STARTER seconds / month  (default 600 = 10 min)
 *   pro     — VOICE_CAP_PRO seconds / month       (default 2400 = 40 min)
 *   elite   — same cap as Pro (VOICE_CAP_PRO)
 *
 * Avatar (Simli) uses a SEPARATE pool — see requireAvatarQuota below.
 * avatar_seconds_used is NOT counted against the voice cap here.
 * Rationale: Sarvam balance (Aria + Elara) is one pool; Simli WebRTC is
 * billed per-minute of active connection and needs its own gate + termination.
 *
 * Bonus seconds (awarded at streak milestones) are consumed first, before
 * counting toward the plan cap — so loyal users get real breathing room,
 * not just a badge.
 */

import { Request, Response, NextFunction } from 'express';
import { db }     from '../../core/database/client';
import { env }    from '../../core/config/env';
import { fail }   from '../../core/utils/response';
import { logger } from '../../infra/logger';

const log = logger.child({ module: 'voice-ledger' });

// Per-plan monthly Sarvam voice caps in seconds.
// Aria (questions) and Elara (corrections) both draw from this pool —
// one debit type, one reset, one balance shown to the user.
// free is blocked before this middleware fires (requireVoiceTier in voice.routes.ts).
const PLAN_VOICE_CAPS: Record<string, number> = {
  starter: env.VOICE_CAP_STARTER,  // 600 s = 10 min
  pro:     env.VOICE_CAP_PRO,      // 2400 s = 40 min
  elite:   env.VOICE_CAP_PRO,      // same 40 min cap as Pro
};

// Streak days that trigger a voice bonus top-up
const STREAK_MILESTONE_DAYS = new Set([7, 14, 21, 28, 35, 42, 60, 90]);

// ── Gate-checking middleware ─────────────────────────────────

/**
 * Express middleware — attach to any voice/avatar route AFTER authMiddleware
 * and requireVoiceTier. Checks whether the user still has monthly voice quota.
 *
 * Fail-open: if the DB check throws (transient error, cold start), the
 * request is allowed through rather than blocking a legitimate paid user.
 * Same philosophy as burst-limiter.ts — visibility (logs) over hard blocking
 * on infrastructure errors.
 *
 * The actual debit (incrementVoiceUsage) happens *after* the upstream call
 * succeeds, in debitVoiceSeconds() called by the controller — so a failed
 * TTS request never burns quota.
 */
export async function requireVoiceQuota(
  req:  Request,
  res:  Response,
  next: NextFunction
): Promise<void> {
  const user = req.user;
  if (!user) { next(); return; }

  // Read the authoritative plan from the DB — the JWT can be stale after an
  // upgrade (user just paid, but the old token still says 'starter').
  // Fail-open on DB error: a transient blip must not block a paying user.
  // This is a fast indexed lookup on users.id — one extra query per TTS call,
  // which is acceptable compared to the risk of gatekeeping the wrong tier.
  const dbUser = await db.getUserById(user.id).catch(() => null);
  const plan   = (dbUser?.plan ?? user.plan ?? 'free') as string;
  const cap    = PLAN_VOICE_CAPS[plan] ?? -1;

  // -1 = unlimited (Elite) — skip the DB read entirely
  if (cap === -1) { next(); return; }

  try {
    const ledger = await db.getVoiceUsage(user.id);

    if (!ledger) {
      // No usage this month yet — always allow
      next(); return;
    }

    // Effective quota = plan cap + bonus seconds earned from streaks
    const effectiveCap = cap + ledger.bonus_voice_seconds;
    // Voice-only: avatar seconds are tracked separately in their own pool
    // (requireAvatarQuota). Counting both here would let heavy avatar use
    // starve Aria/Elara and vice-versa — they're independent features.
    const voiceUsed = ledger.voice_seconds_used;

    if (voiceUsed >= effectiveCap) {
      const bonusNote = ledger.bonus_voice_seconds > 0
        ? ` (includes ${Math.round(ledger.bonus_voice_seconds / 60)} min streak bonus)`
        : '';
      fail(res, 429, 'voice_quota_exhausted',
        `You've used all ${Math.round(effectiveCap / 60)} minutes of voice for this month${bonusNote}. Upgrade for more.`,
        {
          voice_seconds_used:   ledger.voice_seconds_used,
          avatar_seconds_used:  ledger.avatar_seconds_used,
          bonus_voice_seconds:  ledger.bonus_voice_seconds,
          cap_seconds:          effectiveCap,
          plan,
        }
      );
      return;
    }

    (req as Request & { voiceQuotaRemaining?: number }).voiceQuotaRemaining =
      effectiveCap - voiceUsed;

    next();
  } catch (err) {
    // Fail-open: transient DB errors must not block paying users
    log.warn('requireVoiceQuota: DB check failed — allowing request (fail-open)', {
      userId: user.id, plan, error: (err as Error).message,
    });
    next();
  }
}

// ── Post-call debit ──────────────────────────────────────────

/**
 * Debits `seconds` from the user's monthly voice ledger after a
 * successful TTS call. Called by voice.controller.ts once the audio
 * stream has been written to the response — so quota is never burned
 * by a failed upstream call.
 *
 * Non-fatal: a failed debit is logged but does not throw. Over-counting
 * is acceptable as a transient edge case; under-counting (blocking a
 * valid call) is not. Consistent with the treatment of incrementAIUsage
 * in sessions.service.ts.
 *
 * @param userId   — authenticated user
 * @param seconds  — approximate TTS duration to debit (caller estimates
 *                   from char count: 1 char ≈ 50 ms speech ≈ 0.05 s)
 * @param kind     — 'voice' | 'avatar' (avatar debits a separate counter)
 */
export function debitVoiceSeconds(
  userId:  string,
  seconds: number,
  kind:    'voice' | 'avatar' = 'voice',
): void {
  // Fire-and-forget by design: voice debits are non-fatal and must never
  // block the HTTP response. Acknowledged trade-off: if the process restarts
  // in the window between response delivery and the debit landing in Supabase,
  // the debit is lost. Acceptable for a soft cap (the ledger is not billing-
  // critical). If ledger accuracy becomes a hard requirement, migrate to a
  // durable BullMQ job instead.
  const voiceSecs  = kind === 'voice'  ? seconds : 0;
  const avatarSecs = kind === 'avatar' ? seconds : 0;

  db.incrementVoiceUsage(userId, voiceSecs, avatarSecs).catch(err =>
    // Error (not warn) — a failed debit means usage is under-counted, which
    // lets users exceed their voice cap. Page ops so it can be investigated.
    log.error('debitVoiceSeconds: failed to debit voice ledger', {
      userId, seconds, kind, error: (err as Error).message,
    })
  );
}

// ── Streak milestone voice bonus ─────────────────────────────

/**
 * Awards bonus voice seconds when a streak milestone is reached.
 * Called from sessions.service.ts alongside the existing upsell_trigger
 * logic — triggered on the same milestone days (7 / 14 / 21 / …).
 *
 * Non-fatal: a failed top-up is logged but never throws. The session
 * save result is not affected, same as maybeRewardReferrer.
 *
 * @param userId    — the user who just hit a milestone
 * @param streak    — the new streak value (used to gate on milestone days)
 */
export async function maybeAwardStreakVoiceBonus(
  userId: string,
  streak: number,
): Promise<void> {
  if (!STREAK_MILESTONE_DAYS.has(streak)) return;

  const bonusSecs = env.STREAK_VOICE_BONUS_SECS; // default 300 s = 5 min
  const maxBonus  = env.MAX_BONUS_VOICE_SECONDS;  // default 3600 s = 60 min

  try {
    const result = await db.topUpBonusVoiceSeconds(userId, bonusSecs, maxBonus);
    log.info('Streak voice bonus awarded', {
      userId,
      streak,
      bonusSecs,
      totalBonusNow: result.bonus_voice_seconds,
    });
  } catch (err) {
    log.warn('maybeAwardStreakVoiceBonus: top-up failed (non-fatal)', {
      userId, streak, bonusSecs, error: (err as Error).message,
    });
  }
}

// ── Avatar (Simli) quota — separate from Sarvam voice balance ───────────────

// Per-plan avatar caps in seconds. Simli is WebRTC streaming: billed per-minute
// of active connection, not per character. Needs its own gate + termination.
//   Starter: 600 s = 10 min  (taste — 2-3 sessions before upgrade prompt)
//   Pro:     2400 s = 40 min
//   Elite:   4800 s = 80 min
//   free:    0 (avatar toggle never shown to free users)
const PLAN_AVATAR_CAPS: Record<string, number> = {
  starter: env.AVATAR_CAP_STARTER,  // 600 s = 10 min
  pro:     env.AVATAR_CAP_PRO,      // 2400 s = 40 min
  elite:   env.AVATAR_CAP_ELITE,    // 4800 s = 80 min
};

/**
 * Express middleware — gate before opening a Simli WebRTC session.
 * Attach after authMiddleware and the tier gate (Starter+).
 *
 * Returns 429 'avatar_quota_exhausted' if the user has consumed their monthly
 * avatar minutes. Falls through if quota remains or on DB error (fail-open).
 *
 * Attaches `req.avatarSecondsRemaining` for the route handler to return to
 * the frontend so the UI can show the correct balance without an extra round-trip.
 */
export async function requireAvatarQuota(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  const user = req.user;
  if (!user) { next(); return; }

  const dbUser = await db.getUserById(user.id).catch(() => null);
  const plan   = (dbUser?.plan ?? user.plan ?? 'free') as string;
  const cap    = PLAN_AVATAR_CAPS[plan] ?? 0;

  // Free users: avatar is blocked upstream (no toggle in UI) — 0 cap is a
  // safeguard. Elite gets its own cap; no unlimited tier for avatar.
  if (cap === 0) {
    fail(res, 403, 'avatar_not_available',
      'Avatar is not available on your current plan. Upgrade to Starter or above.');
    return;
  }

  try {
    const ledger = await db.getVoiceUsage(user.id);
    const avatarUsed = ledger?.avatar_seconds_used ?? 0;

    if (avatarUsed >= cap) {
      fail(res, 429, 'avatar_quota_exhausted',
        `You've used all ${Math.round(cap / 60)} avatar minutes for this month. Upgrade for more.`,
        {
          avatar_seconds_used: avatarUsed,
          cap_seconds:         cap,
          plan,
        }
      );
      return;
    }

    (req as Request & { avatarSecondsRemaining?: number }).avatarSecondsRemaining =
      cap - avatarUsed;

    next();
  } catch (err) {
    log.warn('requireAvatarQuota: DB check failed — allowing request (fail-open)', {
      userId: user.id, plan, error: (err as Error).message,
    });
    next();
  }
}

/**
 * Debits avatar seconds from the user's monthly ledger.
 * Called server-side at the end of (or during) a Simli WebRTC session.
 *
 * Fire-and-forget, same contract as debitVoiceSeconds. Pass `terminate: true`
 * when this debit is the result of a server-side session kill (balance hit zero).
 *
 * @param userId  — authenticated user
 * @param seconds — WebRTC session duration to debit
 */
export function debitAvatarSeconds(userId: string, seconds: number): void {
  db.incrementVoiceUsage(userId, 0, Math.max(1, Math.round(seconds))).catch(err =>
    log.error('debitAvatarSeconds: failed to debit avatar ledger', {
      userId, seconds, error: (err as Error).message,
    })
  );
}

/**
 * Returns the user's current avatar balance for the billing month.
 * Used by the avatar session monitor to decide when to send the
 * graceful "avatar_session_ended" termination event to the client.
 *
 * Returns null on DB error (caller should fail-open: let the session continue).
 */
export async function getAvatarSecondsRemaining(
  userId: string,
  plan:   string,
): Promise<number | null> {
  const cap = PLAN_AVATAR_CAPS[plan];
  if (cap === undefined) return null;  // unknown plan — fail-open

  try {
    const ledger = await db.getVoiceUsage(userId);
    const used   = ledger?.avatar_seconds_used ?? 0;
    return Math.max(0, cap - used);
  } catch {
    return null;
  }
}
