-- ============================================================
-- RLS default-deny backstop — Supabase migration
-- ============================================================
--
-- Audit finding (MEDIUM #9): the backend's DB client (client.ts) uses the
-- Supabase service role key for every query, which bypasses Row Level
-- Security entirely. That's an intentional architectural decision, not an
-- oversight — see the file-level comment in backend/src/core/database/
-- client.ts for the full reasoning (this app uses custom JWT auth, not
-- Supabase Auth, so auth.uid()-based RLS policies have no session to read
-- from; isolation is instead enforced by every user-scoped query method
-- explicitly filtering on user_id / session ownership).
--
-- This migration does NOT change how the app behaves — the backend always
-- authenticates as service_role, which RLS never restricts, with or
-- without policies. What it does is close the gap for every OTHER way
-- these tables could be reached: if SUPABASE_ANON_KEY (or, worse, the
-- service key) ever ended up in client-side code, a misconfigured
-- Supabase client elsewhere, or a future contributor wiring up
-- supabase-js directly against the anon key, RLS-with-zero-policies means
-- that access is denied by default rather than wide open. This mirrors
-- the pattern already used for email_verification_tokens/sends in
-- migrations/001_email_verification.sql.
--
-- Only enables RLS — adds no policies. If a real product need for
-- anon/authenticated row access ever arises, add narrowly-scoped
-- CREATE POLICY statements at that time; don't default to permissive.
--
-- Safe to run multiple times: enabling RLS on a table that already has
-- it enabled is a no-op, not an error.

BEGIN;

ALTER TABLE IF EXISTS users                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sessions                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS feedback                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stats                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS usage                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS subscriptions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS token_blacklist            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS password_resets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_mistakes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS weak_areas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS score_history              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS referral_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS analytics_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS b2b_leads                  ENABLE ROW LEVEL SECURITY;
-- email_verification_tokens / email_verification_sends already enabled
-- in 001_email_verification.sql — included here as a harmless no-op so
-- this file is a complete, self-contained record of the table list.
ALTER TABLE IF EXISTS email_verification_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_verification_sends   ENABLE ROW LEVEL SECURITY;

COMMIT;
