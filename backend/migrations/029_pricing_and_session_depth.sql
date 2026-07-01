-- Migration 029: New pricing + session depth guard
--
-- Changes:
--   1. increment_session_count RPC — no schema change; bonus cap is now
--      enforced at the application layer (sessions.service.ts) before
--      the cap value is passed in.  This migration documents that intent.
--
--   2. The monthly ai_calls (call_count) gate is retired.  The column
--      remains in the usage table for analytics; it is still incremented
--      once per completed session by incrementAIUsage().  It no longer
--      functions as a hard wall — checkUsageLimit middleware was updated
--      to use a per-session depth guard (MAX_QUESTIONS_PER_SESSION = 15)
--      instead.
--
--   3. New plan pricing (enforced in env.ts / Razorpay order creation):
--        Starter ₹249  — up to 40 sessions/month (30 base + 10 streak bonus)
--        Pro     ₹599  — unlimited sessions, 60 min voice, 60 min avatar
--        Elite   ₹999  — unlimited sessions, 120 min voice + streak bonus, 120 min avatar
--
--   4. Free plan: 5 base sessions + up to 2 streak bonus = 7 max.
--      Previously 3 base sessions.
--
-- No DDL changes required — all enforcement is in application code.
-- This file serves as the audit record for the product change.

-- Verify the usage table has the columns we expect
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usage' AND column_name = 'call_count'
  ) THEN
    RAISE EXCEPTION 'usage.call_count column missing — check migration order';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usage' AND column_name = 'monthly_session_count'
  ) THEN
    RAISE EXCEPTION 'usage.monthly_session_count missing — run migration 018 first';
  END IF;
END;
$$;
