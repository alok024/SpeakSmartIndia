-- ============================================================
-- Migration 024: Streak Freeze + Weekly XP Leaderboard
-- ============================================================
--
-- STREAK FREEZE
--   Earned (not bought): unlocked at 7-day streak milestone.
--   Monthly allowance by plan:
--     free    → 0  (no freezes)
--     starter → 1 / month
--     pro     → 2 / month
--     elite   → -1 (unlimited — system never decrements)
--
--   Columns added to stats:
--     streak_freezes          — current available freezes
--     streak_freeze_reset_at  — timestamp of last monthly replenishment
--     streak_freeze_unlocked  — true once user has hit 7-day milestone once
--
--   Behaviour in increment_user_stats:
--     1. If the user would have their streak reset AND they have freezes > 0
--        (or unlimited/-1), consume one freeze and keep the streak.
--     2. Returns freeze_used=true and freezes_remaining in the result JSON
--        so the controller can send the toast notification.
--
-- WEEKLY XP LEADERBOARD  (replaces monthly)
--   Pro and Elite users only appear in the competitive board.
--   Free/Starter users can see a blurred/locked teaser on the frontend.
--
--   Columns added to stats:
--     xp_weekly               — XP earned since last Sunday midnight IST
--     xp_weekly_reset_at      — timestamp of last weekly reset
--
--   xp_monthly and leaderboard_monthly are kept intact (profile / lifetime
--   ranking uses monthly). The new leaderboard_weekly view drives the
--   leaderboard page and the dashboard widget.
--
--   Weekly reset: reset_weekly_xp() is called lazily from the app on the
--   first leaderboard fetch after Sunday midnight IST, same pattern as
--   the monthly XP reset.
--
-- SAFE TO RE-RUN:
--   All ADD COLUMN use IF NOT EXISTS.
--   All functions use CREATE OR REPLACE.
-- ============================================================

BEGIN;

-- ── 1. Add streak freeze columns to stats ─────────────────────────────────
ALTER TABLE stats
  ADD COLUMN IF NOT EXISTS streak_freezes         int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_freeze_reset_at timestamptz,
  ADD COLUMN IF NOT EXISTS streak_freeze_unlocked boolean     NOT NULL DEFAULT false;

-- ── 2. Add weekly XP columns to stats ────────────────────────────────────
ALTER TABLE stats
  ADD COLUMN IF NOT EXISTS xp_weekly          bigint      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS xp_weekly_reset_at timestamptz;

-- ── 3. Index for weekly leaderboard queries ───────────────────────────────
CREATE INDEX IF NOT EXISTS stats_xp_weekly_desc
  ON stats (xp_weekly DESC, xp_lifetime DESC);

-- ── 4. Helper: freeze allowance for a plan ───────────────────────────────
--
-- Returns the number of freezes to grant per month.
-- -1 = unlimited (Elite).  0 = none (Free).
CREATE OR REPLACE FUNCTION plan_freeze_allowance(p_plan text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_plan
    WHEN 'elite'   THEN -1   -- unlimited
    WHEN 'pro'     THEN  2
    WHEN 'starter' THEN  1
    ELSE                 0   -- free
  END;
$$;

-- ── 5. Replace increment_user_stats — add freeze logic + weekly XP ────────
--
-- Preserves ALL existing behaviour from migration 023 (IST streak, row lock,
-- XP, track bonus, multiplier, monthly reset, jsonb return shape).
-- New additions:
--   p_plan            TEXT   — user's current plan (from req.user; DB-authoritative)
--   freeze_used       bool   — in returned JSON: true if a freeze was consumed
--   freezes_remaining int    — in returned JSON: remaining freezes after this session
--   xp_weekly         bigint — in returned JSON: current weekly XP total
--
-- Freeze replenishment logic (lazy, same as monthly reset pattern):
--   If streak_freeze_reset_at is NULL or in a prior IST calendar month,
--   reset streak_freezes to the plan's monthly allowance before applying
--   freeze logic. This ensures freezes are available from the 1st of each
--   month without a cron job.
--
-- Freeze consumption:
--   Only fires when:
--     a) the user's streak would reset (gap > 1 IST day)
--     b) streak_freeze_unlocked = true (they earned it by hitting 7 days)
--     c) they have freezes > 0 OR allowance = -1 (unlimited/Elite)
--   When consumed: keep current streak, decrement (unless unlimited), log it.
--
-- Weekly XP reset (lazy):
--   If xp_weekly_reset_at is NULL or the most recent Sunday midnight IST has
--   passed since the last reset, zero xp_weekly before incrementing.
CREATE OR REPLACE FUNCTION increment_user_stats(
  p_user_id     uuid,
  p_score       numeric,
  p_job_ready   numeric,
  p_total_score numeric,
  p_profession  text    DEFAULT 'General',
  p_plan        text    DEFAULT 'free'
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_now_ist        timestamptz := now() AT TIME ZONE 'Asia/Kolkata';
  v_today          date        := v_now_ist::date;
  v_yesterday      date        := v_today - 1;
  v_last           date;
  v_streak         int;
  v_row            stats%ROWTYPE;
  v_xp             int;
  v_track_bonus    int  := 0;
  v_is_new_track   bool;
  v_freeze_used    bool := false;
  v_allowance      int;
  v_need_freeze    bool;
  -- Weekly reset: last Sunday midnight IST (Sunday = dow 0)
  v_last_sunday    date := v_today - EXTRACT(dow FROM v_today)::int;
  v_last_sunday_ts timestamptz;
  v_do_week_reset  bool;
BEGIN
  -- Ensure stats row exists
  INSERT INTO stats (
    user_id, sessions, best_score, total_score,
    avg_job_ready_score, total_sessions_with_score,
    streak, last_session, updated_at,
    xp_lifetime, xp_monthly, xp_weekly,
    streak_freezes, streak_freeze_unlocked
  )
  VALUES (p_user_id, 0, 0, 0, 0, 0, 0, null, now(), 0, 0, 0, 0, false)
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock row for this transaction
  SELECT * INTO v_row FROM stats WHERE user_id = p_user_id FOR UPDATE;

  -- ── Streak calculation ────────────────────────────────────────────────
  v_last   := (v_row.last_session AT TIME ZONE 'Asia/Kolkata')::date;
  v_streak := CASE
    WHEN v_last = v_today     THEN v_row.streak       -- same IST day: keep
    WHEN v_last = v_yesterday THEN v_row.streak + 1   -- consecutive: +1
    ELSE 1                                             -- gap: reset (maybe frozen below)
  END;

  -- ── Streak freeze logic ───────────────────────────────────────────────
  v_need_freeze := (v_last IS NOT NULL)
               AND (v_last <> v_today)
               AND (v_last <> v_yesterday);

  IF v_need_freeze AND v_row.streak_freeze_unlocked THEN
    v_allowance := plan_freeze_allowance(p_plan);

    -- Lazy monthly replenish: if reset_at is null or in a prior IST month
    IF v_allowance > 0 AND (
      v_row.streak_freeze_reset_at IS NULL
      OR (v_row.streak_freeze_reset_at AT TIME ZONE 'Asia/Kolkata')::date
           < DATE_TRUNC('month', v_now_ist)::date
    ) THEN
      v_row.streak_freezes         := v_allowance;
      v_row.streak_freeze_reset_at := now();
    END IF;

    -- Consume freeze if available
    IF v_allowance = -1 OR v_row.streak_freezes > 0 THEN
      v_streak     := v_row.streak;  -- keep existing streak
      v_freeze_used := true;
      IF v_allowance <> -1 THEN
        v_row.streak_freezes := v_row.streak_freezes - 1;
      END IF;
    END IF;
  END IF;

  -- Unlock freeze entitlement at 7-day milestone (once, never revoked)
  IF v_streak >= 7 AND NOT v_row.streak_freeze_unlocked THEN
    v_row.streak_freeze_unlocked := true;
  END IF;

  -- ── Lazy weekly XP reset ──────────────────────────────────────────────
  v_last_sunday_ts := (v_last_sunday::timestamptz AT TIME ZONE 'Asia/Kolkata');
  v_do_week_reset  := v_row.xp_weekly_reset_at IS NULL
                   OR v_row.xp_weekly_reset_at < v_last_sunday_ts;
  IF v_do_week_reset THEN
    v_row.xp_weekly          := 0;
    v_row.xp_weekly_reset_at := v_last_sunday_ts;
  END IF;

  -- ── Track-first-session XP bonus ─────────────────────────────────────
  SELECT NOT EXISTS (
    SELECT 1 FROM sessions
    WHERE user_id    = p_user_id
      AND profession = p_profession
      AND status     = 'completed'
  ) INTO v_is_new_track;
  IF v_is_new_track THEN v_track_bonus := 100; END IF;

  -- ── XP computation ────────────────────────────────────────────────────
  v_xp := compute_session_xp(p_score, v_streak) + v_track_bonus;

  -- ── Lazy monthly XP reset (inherited from migration 023) ──────────────
  -- Handled in the app layer (sessions.service.ts) via reset_monthly_xp(),
  -- so we intentionally do NOT zero xp_monthly here to avoid double reset.

  -- ── Atomic update ────────────────────────────────────────────────────
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
    xp_monthly                = v_row.xp_monthly  + v_xp,
    xp_weekly                 = v_row.xp_weekly   + v_xp,
    xp_weekly_reset_at        = v_row.xp_weekly_reset_at,
    streak_freezes            = v_row.streak_freezes,
    streak_freeze_reset_at    = COALESCE(v_row.streak_freeze_reset_at, stats.streak_freeze_reset_at),
    streak_freeze_unlocked    = v_row.streak_freeze_unlocked
  WHERE user_id = p_user_id;

  SELECT * INTO v_row FROM stats WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'sessions',            v_row.sessions,
    'best_score',          v_row.best_score,
    'streak',              v_row.streak,
    'avg_job_ready_score', v_row.avg_job_ready_score,
    'xp_lifetime',         v_row.xp_lifetime,
    'xp_monthly',          v_row.xp_monthly,
    'xp_weekly',           v_row.xp_weekly,
    'xp_earned',           v_xp,
    'freeze_used',         v_freeze_used,
    'freezes_remaining',   CASE WHEN plan_freeze_allowance(p_plan) = -1 THEN -1
                                ELSE v_row.streak_freezes END
  );
END;
$$;

-- ── 6. Weekly leaderboard view (Pro + Elite only) ────────────────────────
--
-- Joins stats → users → subscriptions. Only users whose active subscription
-- is pro or elite appear. Free/Starter users are excluded from the ranked
-- list (frontend shows a blurred placeholder for them).
--
-- Ties: secondary sort xp_lifetime, tertiary user_id (stable, no name leak).
CREATE OR REPLACE VIEW leaderboard_weekly AS
SELECT
  ROW_NUMBER() OVER (
    ORDER BY s.xp_weekly DESC, s.xp_lifetime DESC, s.user_id
  )::int                     AS rank,
  u.name                     AS display_name,
  s.xp_weekly,
  s.xp_lifetime,
  s.streak,
  s.user_id
FROM stats s
JOIN users u ON u.id = s.user_id
WHERE s.xp_weekly > 0
  AND (
    u.plan IN ('pro', 'elite')
    OR (u.elite_trial_expires_at IS NOT NULL AND u.elite_trial_expires_at > NOW())
  )
ORDER BY s.xp_weekly DESC, s.xp_lifetime DESC, s.user_id;

-- ── 7. Weekly reset function ──────────────────────────────────────────────
--
-- Called lazily from the app on first leaderboard fetch after Sunday midnight IST.
-- Zeroes xp_weekly for ALL users (Pro/Elite earn it; the zero is a no-op for
-- Free/Starter since they don't accumulate xp_weekly > 0 in the view anyway,
-- but resetting them keeps the column clean).
CREATE OR REPLACE FUNCTION reset_weekly_xp()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stats SET
    xp_weekly          = 0,
    xp_weekly_reset_at = now()
  WHERE xp_weekly > 0;
END;
$$;

COMMIT;
