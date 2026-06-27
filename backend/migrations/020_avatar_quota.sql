-- Migration 020: Avatar (Simli) quota — separate from Sarvam voice balance
--
-- avatar_seconds_used already exists in voice_usage_ledger (migration 011).
-- This migration adds two things:
--   1. An RPC for atomic avatar quota gate-check (read-then-fail, no write)
--      used by requireAvatarQuota middleware before opening a Simli connection.
--   2. An RPC for server-side termination: returns the avatar seconds remaining
--      so the Node process can decide to kill the Simli WebRTC session and
--      notify the client via a server-sent event or WebSocket message.
--
-- Per-plan avatar caps (seconds):
--   Starter: 600 s  = 10 min   (taste — 2-3 sessions)
--   Pro:     2400 s = 40 min
--   Elite:   4800 s = 80 min
--   Free:    0      (no avatar; gated upstream)
--
-- Avatar minutes reset on the 1st of each IST month, same as voice
-- (both use voice_current_ist_month() defined in migration 011).
-- No separate bonus pool for avatar — streak bonuses apply to voice only.

-- ── RPC: get_avatar_quota ────────────────────────────────────
--
-- Returns { avatar_seconds_used, cap_seconds, remaining_seconds }.
-- cap_seconds is passed in by the caller (Node reads it from env).
-- Returns remaining_seconds = -1 when no row exists for the current month
-- (i.e., first avatar use this month; caller should allow through).
--
-- Used by requireAvatarQuota middleware and the Simli session monitor.
CREATE OR REPLACE FUNCTION get_avatar_quota(
  p_user_id  bigint,
  p_cap_secs integer   -- caller-supplied per-plan cap; -1 = unlimited
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_month date := voice_current_ist_month();
  v_used  integer;
BEGIN
  SELECT avatar_seconds_used INTO v_used
  FROM   voice_usage_ledger
  WHERE  user_id      = p_user_id
    AND  billing_month = v_month;

  -- No row yet this month → no usage
  IF NOT FOUND THEN
    v_used := 0;
  END IF;

  RETURN jsonb_build_object(
    'avatar_seconds_used', v_used,
    'cap_seconds',         p_cap_secs,
    'remaining_seconds',   CASE WHEN p_cap_secs = -1 THEN -1
                                ELSE GREATEST(0, p_cap_secs - v_used) END
  );
END;
$$;
