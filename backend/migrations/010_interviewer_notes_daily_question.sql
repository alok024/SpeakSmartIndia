-- ============================================================
-- Interviewer's Notes + Daily Question Drop — Supabase migration
-- ============================================================
--
-- Two independent "Easy" build items (vachix_b2c_build_plan(1).md §2),
-- bundled into one migration since both are additive and low-risk.
--
-- 1. Interviewer's Notes
--    A single nullable column on the existing `sessions` table. Written
--    once, after the session is already saved, by a background job (see
--    infra/queue/worker.ts case 'generate-interviewer-notes' and
--    db.setSessionInterviewerNotes in core/database/client.ts). Null
--    until that job completes, or forever if it failed — the column is
--    designed to be safely absent, so no backfill is needed and no
--    existing row is affected by adding it.
--
-- 2. Daily Question Drop
--    A small standalone table, one row per IST calendar day. Read-heavy,
--    write-rarely (one INSERT per day, race-safe via the `date` PK — see
--    db.createDailyQuestionIfMissing). Not user-scoped, so there's no
--    per-user filtering to enforce; RLS is still enabled per this
--    project's default-deny policy (see 008_rls_default_deny.sql) even
--    though the backend always reads it via the service-role key.
--
-- Safe to run multiple times: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF
-- NOT EXISTS are idempotent.

BEGIN;

ALTER TABLE IF EXISTS sessions
  ADD COLUMN IF NOT EXISTS interviewer_notes text;

CREATE TABLE IF NOT EXISTS daily_questions (
  date        date PRIMARY KEY,           -- IST calendar day, e.g. '2026-06-21'
  question    text NOT NULL,
  profession  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS daily_questions ENABLE ROW LEVEL SECURITY;

COMMIT;
