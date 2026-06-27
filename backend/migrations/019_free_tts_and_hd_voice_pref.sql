-- Migration 019: Free TTS character tracking + HD voice preference
--
-- Free tier: Web Speech API (window.speechSynthesis) is used client-side at zero cost.
-- We cap free users at ~15 min/month (54,000 chars at ~60 chars/s) to create a tangible
-- gap vs paid plans. Characters are tracked server-side so the cap cannot be bypassed.
--
-- Paid tiers: users can toggle between Standard (Web Speech) and HD (Sarvam Bulbul v3).
-- The toggle preference is stored on the users table as hd_voice_enabled (default false).

-- 1. HD voice preference on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS hd_voice_enabled boolean NOT NULL DEFAULT false;

-- 2. Free TTS usage tracking table
-- billing_month = first day of the current IST calendar month ('YYYY-MM-DD').
-- chars_used resets to 0 at the start of each new billing month (new row per month).
CREATE TABLE IF NOT EXISTS free_tts_usage (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  billing_month  date        NOT NULL,  -- first day of IST month
  chars_used     integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, billing_month)
);

-- RLS: deny all direct access; only service role key (used by our backend) can read/write.
ALTER TABLE free_tts_usage ENABLE ROW LEVEL SECURITY;

-- 3. RPC: get chars used this IST billing month for a user.
-- Returns 0 if no row exists yet (first call this month).
CREATE OR REPLACE FUNCTION get_free_tts_chars_used(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT chars_used
       FROM free_tts_usage
      WHERE user_id = p_user_id
        AND billing_month = date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date
      LIMIT 1),
    0
  );
$$;

-- 4. RPC: atomically increment chars used. Creates the row if missing.
-- Returns the new total after increment.
CREATE OR REPLACE FUNCTION increment_free_tts_chars(p_user_id uuid, p_chars integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_month date := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  v_new   integer;
BEGIN
  INSERT INTO free_tts_usage (user_id, billing_month, chars_used, updated_at)
  VALUES (p_user_id, v_month, p_chars, now())
  ON CONFLICT (user_id, billing_month)
  DO UPDATE SET
    chars_used = free_tts_usage.chars_used + EXCLUDED.chars_used,
    updated_at = now()
  RETURNING chars_used INTO v_new;
  RETURN v_new;
END;
$$;
