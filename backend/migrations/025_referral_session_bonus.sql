-- Migration 025: Referral bonus sessions
--
-- Moves referral rewards from the `users.referral_bonus` (AI-call counter)
-- to a monthly session bonus tracked in the `usage` table.
--
-- Changes:
--   1. usage: add `monthly_session_bonus` (resets each IST month alongside
--      monthly_session_count) and `monthly_session_bonus_reset_at`.
--   2. grant_referral_bonus_sessions: atomic upsert that credits sessions to
--      the current-month bonus pool — replaces increment_referral_bonus.
--
-- The old `users.referral_bonus` column and `increment_referral_bonus` function
-- are intentionally NOT dropped here to preserve history and allow a clean
-- rollback. Drop them in a future migration once this is stable in production.
--
-- Bonus semantics:
--   • monthly_session_bonus is added to the plan's base monthly session cap
--     at enforcement time (sessions.service.ts).
--   • Resets to 0 on the first session of a new IST month (lazy reset,
--     same pattern as monthly_session_count).
--   • No roll-over — creates monthly referral motivation.

-- ── 1. Extend usage table ────────────────────────────────────────────────────

ALTER TABLE usage
  ADD COLUMN IF NOT EXISTS monthly_session_bonus          INT         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_session_bonus_reset_at TIMESTAMPTZ;

-- ── 2. grant_referral_bonus_sessions ────────────────────────────────────────
--
-- Atomically credits `p_amount` bonus sessions to a user's current-month pool.
-- Creates the usage row if it doesn't exist (same pattern as increment_usage).
-- No hard-cap param needed: monthly reset is the natural ceiling.

CREATE OR REPLACE FUNCTION grant_referral_bonus_sessions(
  p_user_id UUID,
  p_amount  INT
)
RETURNS VOID
LANGUAGE sql
AS $$
  INSERT INTO usage (
    user_id,
    call_count,
    monthly_session_bonus,
    monthly_session_bonus_reset_at,
    updated_at
  )
  VALUES (
    p_user_id,
    0,
    p_amount,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET monthly_session_bonus          = usage.monthly_session_bonus + p_amount,
        monthly_session_bonus_reset_at = COALESCE(
                                           usage.monthly_session_bonus_reset_at,
                                           now()
                                         ),
        updated_at                     = now();
$$;
