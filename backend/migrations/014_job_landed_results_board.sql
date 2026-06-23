-- ============================================================
-- Job Landed + Results Board — Supabase migration
-- ============================================================
--
-- Feature: Users who land a job after using Vachix can self-report
-- their win via a dashboard card (shown after ≥5 sessions). They
-- optionally opt-in to the public Results Board, which acts as
-- social proof / referral surface.
--
-- Design choices:
--   • job_landed_* columns live directly on `users` rather than a
--     separate table — it's a single event per user lifecycle, not
--     a repeating record, so a FK join table would be over-engineering.
--     The presence of job_landed_at (non-null) is the "did they land?"
--     flag; hiding the card post-submit is a frontend read of this field.
--   • `results_board` is a separate, lightweight table with only the
--     display data needed by the public page — no PII except name/company
--     which the user explicitly chooses to share. user_id FK lets us
--     cascade-delete if the account is removed (GDPR).
--   • results_board has NO RLS — it's intentionally public. Row-level
--     insert/update protection is enforced at the app layer (controller
--     verifies auth before writing). We don't need RLS for a read-only
--     public table.
--   • display_name in results_board can differ from users.name — the
--     user types what they want shown publicly (e.g., first name only).
--   • The card visibility logic (≥5 sessions, job_landed_at IS NULL)
--     is frontend-only — the backend just stores and retrieves; it
--     doesn't gate the POST endpoint by session count so an admin or
--     power user can submit any time.
--
-- Safe to run multiple times — idempotent throughout.

BEGIN;

-- 1. Extend users table with job-landed columns
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS job_landed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS job_landed_role     TEXT,
  ADD COLUMN IF NOT EXISTS job_landed_company  TEXT;

-- 2. Results board — public opt-in showcase
CREATE TABLE IF NOT EXISTS results_board (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Display data chosen by the user (can differ from account name/company)
  display_name   TEXT        NOT NULL,
  role           TEXT        NOT NULL,
  company        TEXT,                           -- optional — some prefer to omit
  sessions_count INTEGER     NOT NULL CHECK (sessions_count >= 0),
  avg_score      NUMERIC(4,2),                   -- snapshot at time of submission

  -- OG image token — HMAC of user_id; lets /api/og/job-landed verify
  -- requests without a lookup, same pattern as report share tokens.
  og_token       TEXT        NOT NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One entry per user — if they resubmit we UPSERT in place
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_results_board_created
  ON results_board (created_at DESC);

-- RLS: intentionally off — table is public read, app-layer write-guarded
ALTER TABLE IF EXISTS results_board DISABLE ROW LEVEL SECURITY;

COMMIT;
