-- Migration 030: Pro/Elite session caps
--
-- Phase 0 changes:
--
--   1. Pro and Elite plans now have monthly session caps enforced in
--      application code (sessions.service.ts).  Previously they fell
--      straight through with no cap.
--
--      Cap summary (base + max streak bonus = hard ceiling):
--        Free:    5  base + up to  2 streak bonus = 7   max/month
--        Starter: 30 base + up to 10 streak bonus = 40  max/month
--        Pro:     60 base + up to 15 streak bonus = 75  max/month
--        Elite:   90 base + up to 20 streak bonus = 110 max/month
--
--      The enforcement uses the existing increment_session_count RPC —
--      no schema change required.  This file records the product decision.
--
--   2. Milestone thresholds expanded from [7, 30, 60, 90] to
--      [3, 7, 14, 21, 30, 60, 90].  New milestones:
--        Day  3 — +1 bonus session (free users only)
--        Day  7 — +5 bonus voice minutes + streak-freeze slot (was freeze-only)
--        Day 14 — +5 bonus sessions (all plans)
--        Day 21 — +15 bonus voice minutes
--      Delivered by milestone-rewards.service.ts; no new DB objects required.
--      Full milestone delivery (coupons, tier upgrades, comeback emails) is
--      Phase 4 work.
--
--   3. Voice cap for Elite tier updated to VOICE_CAP_ELITE (7200 s = 120 min),
--      separated from VOICE_CAP_PRO.  Previously Elite was aliased to Pro's cap
--      (40 min).  Enforced in voice.ledger.ts and voice.controller.ts.
--
-- No DDL changes required — all enforcement is application-layer config.
-- This file is the audit record for the product change.

-- Sanity check: verify increment_session_count RPC exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'increment_session_count'
  ) THEN
    RAISE EXCEPTION 'increment_session_count RPC missing — run migrations 018 and 029 first';
  END IF;
END;
$$;

-- Sanity check: confirm grant_referral_bonus_sessions exists (reused for
-- milestone bonus session credits at days 3 and 14).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'grant_referral_bonus_sessions'
  ) THEN
    RAISE EXCEPTION 'grant_referral_bonus_sessions RPC missing — run migration 025 first';
  END IF;
END;
$$;
