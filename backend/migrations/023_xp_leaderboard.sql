-- ============================================================
-- Migration 023: XP system + leaderboard
-- ============================================================
--
-- XP EARN RATES (from spec):
--   Base session completion  : +50 XP
--   Score > 8.0 (80%)        : +25 XP bonus
--   First session on a new profession (track): +100 XP bonus
--   7-day streak active      : 1.5× multiplier on all XP earned this session
--   30-day streak active     : 2.0× multiplier (supersedes 1.5×)
--
-- STORAGE:
--   xp_lifetime  — never resets; shown on profile + used for all-time ranking
--   xp_monthly   — resets first day of each IST calendar month; used for leaderboard
--
-- LEADERBOARD:
--   A view over `stats` ordered by xp_monthly DESC, xp_lifetime DESC.
--   Monthly reset handled by reset_monthly_xp() called from the app on
--   first session of a new IST month (same lazy-reset pattern as session caps).
--   A pg_cron job can also be wired here if desired.
--
-- SAFE TO RE-RUN:
--   ALTER COLUMN is idempotent because columns are created IF NOT EXISTS
--   and CREATE OR REPLACE FUNCTION is always safe.

BEGIN;

-- ── 1. Add XP columns to stats ────────────────────────────────────────────
ALTER TABLE stats
  ADD COLUMN IF NOT EXISTS xp_lifetime  bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS xp_monthly   bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS xp_reset_at  timestamptz;   -- tracks when monthly reset last ran

-- ── 2. Index for leaderboard queries ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS stats_xp_monthly_desc
  ON stats (xp_monthly DESC, xp_lifetime DESC);

-- ── 3. Helper: compute XP for a session ──────────────────────────────────
--
-- Pure function — no side effects; used inside increment_user_stats.
-- Separated so it's easily unit-testable via SELECT compute_session_xp(...).
CREATE OR REPLACE FUNCTION compute_session_xp(
  p_score   numeric,   -- session score (0–10 scale)
  p_streak  int        -- streak AFTER this session (already incremented)
) RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_base       int := 50;
  v_bonus      int := 0;
  v_multiplier numeric := 1.0;
  v_total      int;
BEGIN
  -- Score bonus: score > 8.0 means > 80% on 0–10 scale
  IF p_score > 8.0 THEN
    v_bonus := v_bonus + 25;
  END IF;

  -- Streak multiplier (higher streak wins)
  IF p_streak >= 30 THEN
    v_multiplier := 2.0;
  ELSIF p_streak >= 7 THEN
    v_multiplier := 1.5;
  END IF;

  v_total := ROUND((v_base + v_bonus) * v_multiplier);
  RETURN v_total;
END;
$$;

-- ── 4. Replace increment_user_stats — add XP + track-first-session bonus ─
--
-- Preserves ALL existing behaviour (streak IST fix, row-level lock, same
-- return shape + new xp_earned field).  Adding xp_earned to the returned
-- jsonb is backwards-compatible — callers that don't read it are unaffected.
--
-- p_profession is the session's profession string.  We detect "first ever
-- session on this profession" by checking sessions where profession matches;
-- the 100 XP bonus fires once per profession per user lifetime.
CREATE OR REPLACE FUNCTION increment_user_stats(
  p_user_id     uuid,
  p_score       numeric,
  p_job_ready   numeric,
  p_total_score numeric,
  p_profession  text DEFAULT 'General'
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_today         date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_yesterday     date := v_today - 1;
  v_last          date;
  v_streak        int;
  v_row           stats%ROWTYPE;
  v_xp            int;
  v_track_bonus   int := 0;
  v_is_new_track  bool;
BEGIN
  -- Ensure the row exists before locking
  INSERT INTO stats (
    user_id, sessions, best_score, total_score,
    avg_job_ready_score, total_sessions_with_score,
    streak, last_session, updated_at,
    xp_lifetime, xp_monthly
  )
  VALUES (p_user_id, 0, 0, 0, 0, 0, 0, null, now(), 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock for duration of this transaction
  SELECT * INTO v_row FROM stats WHERE user_id = p_user_id FOR UPDATE;

  -- Streak calculation (IST-aware, unchanged from migration 009)
  v_last   := (v_row.last_session AT TIME ZONE 'Asia/Kolkata')::date;
  v_streak := CASE
    WHEN v_last = v_today     THEN v_row.streak
    WHEN v_last = v_yesterday THEN v_row.streak + 1
    ELSE 1
  END;

  -- First-session-on-this-track bonus
  -- We consider it "new" if the user has zero COMPLETED sessions with this profession.
  SELECT NOT EXISTS (
    SELECT 1 FROM sessions
    WHERE user_id    = p_user_id
      AND profession = p_profession
      AND status     = 'completed'
  ) INTO v_is_new_track;

  IF v_is_new_track THEN
    v_track_bonus := 100;
  END IF;

  -- Compute XP for this session (uses updated streak)
  v_xp := compute_session_xp(p_score, v_streak) + v_track_bonus;

  -- Apply all updates atomically
  UPDATE stats SET
    sessions                  = v_row.sessions + 1,
    best_score                = GREATEST(v_row.best_score, p_score),
    total_score               = v_row.total_score + p_total_score,
    avg_job_ready_score       = ROUND(
                                  ((v_row.avg_job_ready_score * v_row.total_sessions_with_score)
                                    + p_job_ready)
                                  / (v_row.total_sessions_with_score + 1),
                                  2),
    total_sessions_with_score = v_row.total_sessions_with_score + 1,
    streak                    = v_streak,
    last_session              = now(),
    updated_at                = now(),
    xp_lifetime               = v_row.xp_lifetime + v_xp,
    xp_monthly                = v_row.xp_monthly  + v_xp
  WHERE user_id = p_user_id;

  SELECT * INTO v_row FROM stats WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'sessions',            v_row.sessions,
    'best_score',          v_row.best_score,
    'streak',              v_row.streak,
    'avg_job_ready_score', v_row.avg_job_ready_score,
    'xp_lifetime',         v_row.xp_lifetime,
    'xp_monthly',          v_row.xp_monthly,
    'xp_earned',           v_xp
  );
END;
$$;

-- ── 5. Monthly leaderboard view ───────────────────────────────────────────
--
-- Exposes only what the frontend needs: rank, display name, XP, streak.
-- No PII beyond display_name (which users choose themselves).
-- Tied XP: secondary sort is xp_lifetime, tertiary is user_id (stable).
CREATE OR REPLACE VIEW leaderboard_monthly AS
SELECT
  ROW_NUMBER() OVER (
    ORDER BY s.xp_monthly DESC, s.xp_lifetime DESC, s.user_id
  )::int                     AS rank,
  u.name                     AS display_name,
  s.xp_monthly,
  s.xp_lifetime,
  s.streak,
  s.user_id
FROM stats s
JOIN users u ON u.id = s.user_id
WHERE s.xp_monthly > 0
ORDER BY s.xp_monthly DESC, s.xp_lifetime DESC, s.user_id;

-- ── 6. Monthly reset function ─────────────────────────────────────────────
--
-- Resets xp_monthly for all users and records the reset timestamp.
-- Called lazily from the app (same pattern as session cap reset) or by
-- a scheduled pg_cron job: "0 0 1 * *" (midnight UTC 1st of month).
CREATE OR REPLACE FUNCTION reset_monthly_xp()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stats SET
    xp_monthly  = 0,
    xp_reset_at = now()
  WHERE xp_monthly > 0;
END;
$$;

COMMIT;
