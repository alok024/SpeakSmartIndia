-- ============================================================
-- Migration 028: DAF profile fields + company mode column
-- ============================================================
--
-- Feature 1 — UPSC DAF-based interview prep:
--   Adds structured DAF (Detailed Application Form) fields to the users
--   table. These are filled once in the profile page and injected into
--   every UPSC session's system prompt by onboarding-context.ts, enabling
--   personalised questions like "You mentioned mountaineering as a hobby —
--   how does that shape your approach to challenges in administration?"
--
-- Feature 2 — Company-specific campus mode:
--   Adds a company_mode column to the users table so the last-used company
--   target persists between sessions. The actual per-session selection also
--   lives in the interview config store (no DB lookup needed at session
--   start), but persisting it to the profile ensures the preference survives
--   page reloads and comes back pre-filled on the next setup screen visit.
--
-- Both columns are nullable — absence means feature not configured, which
-- degrades gracefully (no DAF context injected, no company-mode prompt).
--
-- All ALTER TABLE … ADD COLUMN IF NOT EXISTS so this is safe to re-run.

BEGIN;

-- ── DAF fields ────────────────────────────────────────────────────────────────

-- Full name as it appears on UPSC application (may differ from users.name)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daf_name text;

-- Home state (e.g. "Maharashtra", "Uttar Pradesh")
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daf_home_state text;

-- Graduation subject (e.g. "Computer Science", "History")
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daf_graduation_subject text;

-- Graduation college/university name
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daf_graduation_college text;

-- UPSC optional subject (e.g. "Geography", "Public Administration")
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daf_optional_subject text;

-- Up to 3 hobbies — stored as a comma-separated string for simplicity.
-- The prompt layer splits on comma and formats them into a numbered list.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daf_hobbies text;

-- Work experience summary (free text, 500 char limit enforced at app layer)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daf_work_experience text;

-- Extra-curriculars (e.g. "NCC A Certificate, State-level chess player")
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daf_extracurriculars text;

-- ── Company mode ──────────────────────────────────────────────────────────────

-- Last-selected company target for campus interview mode.
-- Valid values mirror COMPANY_MODES in interview-prompts.ts:
--   'tcs' | 'infosys' | 'wipro' | 'accenture' |
--   'amazon' | 'google' | 'flipkart'
-- NULL = no company mode selected (generic prep).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_company_mode text;

COMMIT;
