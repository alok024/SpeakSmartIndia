-- ============================================================
-- Migration 026: Streak Milestone Rewards
-- ============================================================
--
-- Tracks which streak milestones (7 / 30 / 60 / 90 days) have
-- been awarded per user, and stores the runtime state needed for
-- the 30-day XP double-day and 90-day Elite trial.
--
-- DESIGN:
--   milestone_rewards_granted (jsonb, default '{}'):
--     Records awarded milestones as boolean flags so re-runs are
--     idempotent.  Keys: "7", "30", "60", "90".
--     Example: '{"7": true, "30": true}'
--
--   xp_double_day (date, nullable):
--     Set to the IST calendar date when the 30-day reward fires.
--     increment_user_stats checks this column during XP calculation:
--     if xp_double_day matches today (IST), XP is doubled before
--     applying the existing streak multiplier.
--     Cleared to NULL once the day has passed (lazy, on next session).
--
--   elite_trial_expires_at (timestamptz, nullable):
--     Set to NOW() + 7 days when the 90-day milestone fires.
--     The auth middleware / plan-resolution helpers treat a non-null
--     future value here as equivalent to 'elite' plan for feature
--     gating, without touching the users.plan column.
--     Expired values are left in place (< NOW() = no effect).
--
--   weekly_card_voiced_url (text, nullable):
--     Stores the Base64-encoded WAV audio of the Elara voiced
--     summary for Pro+ users. Served by GET /api/weekly-card/:userId/voice.
--     Regenerated each Sunday alongside the SVG card.
--
-- SAFE TO RE-RUN: all ADD COLUMN use IF NOT EXISTS.
-- ============================================================

BEGIN;

-- ── 1. Milestone tracking on users ───────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS milestone_rewards_granted jsonb        NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS xp_double_day             date,
  ADD COLUMN IF NOT EXISTS elite_trial_expires_at    timestamptz,
  -- NOTE: weekly_card_voiced_url is conceptually owned by the weekly-card
  -- feature (migration 015), but is added here because it was introduced
  -- alongside the milestone columns in the same release.  If migrations are
  -- ever split by domain, move this column to a new 015b_weekly_card_voice.sql
  -- and remove it from here — the ADD COLUMN IF NOT EXISTS guard makes that
  -- safe to run after this migration has already applied.
  ADD COLUMN IF NOT EXISTS weekly_card_voiced_url    text;

-- ── 2. Index: fast lookup for elite-trial enforcement ─────────────────────────
-- Used by any middleware that needs to check trial status without loading
-- the whole subscriptions table for the user.
CREATE INDEX IF NOT EXISTS users_elite_trial_expires_at_idx
  ON users (elite_trial_expires_at)
  WHERE elite_trial_expires_at IS NOT NULL;

-- ── 3. Helper: effective plan (respects active elite trial) ───────────────────
--
-- Returns 'elite' if the user has a non-expired elite trial, otherwise
-- returns users.plan.  Called from application code where needed; keeps
-- plan-resolution logic in one place rather than scattered across services.
--
-- Usage example (psql / RPC):
--   SELECT effective_plan(id) FROM users WHERE id = $1;
-- NOTE: p_user_id is uuid — matching users.id as established in migration 001.
CREATE OR REPLACE FUNCTION effective_plan(p_user_id uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN elite_trial_expires_at IS NOT NULL
     AND elite_trial_expires_at > NOW()
    THEN 'elite'
    ELSE plan
  END
  FROM users
  WHERE id = p_user_id;
$$;

-- ── 4. RPC: grant_milestone_reward ───────────────────────────────────────────
--
-- Atomically merges a single key into milestone_rewards_granted without
-- a read-modify-write race.  Called by db.grantMilestoneReward().
--
-- p_milestone is the string key ("7", "30", "60", "90").
--
-- NOTE: p_user_id is uuid — matching users.id as established in migration 001.
-- PostgREST passes the user's UUID string to this RPC; a bigint signature
-- would cause a type mismatch and a 404/400 from PostgREST.
CREATE OR REPLACE FUNCTION grant_milestone_reward(p_user_id uuid, p_milestone text)
RETURNS void LANGUAGE sql AS $$
  UPDATE users
  SET milestone_rewards_granted =
        COALESCE(milestone_rewards_granted, '{}'::jsonb) || jsonb_build_object(p_milestone, true),
      updated_at = NOW()
  WHERE id = p_user_id;
$$;

-- ── 5. Helper: current IST calendar date ─────────────────────────────────────

CREATE OR REPLACE FUNCTION ist_today() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date;
$$;

COMMIT;
