-- ============================================================
-- Onboarding + Admin — Supabase migration (v1)
-- ============================================================

-- 1. Onboarding intent fields on users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_profession   text,
  ADD COLUMN IF NOT EXISTS onboarding_goal         text,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

-- Index for admin funnel queries (how many users completed onboarding)
CREATE INDEX IF NOT EXISTS idx_users_onboarding_completed
  ON users(onboarding_completed_at);

-- 2. Admin role flag — manually set to true for operator accounts via SQL
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Example (run manually, replace email):
-- UPDATE users SET is_admin = true WHERE email = 'founder@vachix.in';
