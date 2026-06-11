-- ════════════════════════════════════════════════════════════════
--  SpeakSmart — Maintenance Migration
--  Run in Supabase SQL editor (or via psql)
-- ════════════════════════════════════════════════════════════════

-- ── H1: Atomic usage increment (fixes BUG 2 race condition) ──────
-- Called by db.incrementUsage() instead of the read-then-PATCH pattern.
CREATE OR REPLACE FUNCTION increment_usage(p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO usage (user_id, call_count, updated_at)
  VALUES (p_user_id, 1, now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    call_count = usage.call_count + 1,
    updated_at = now();
$$;

-- ── H1: Token blacklist cleanup (prevent unbounded table growth) ──
-- Schedule via pg_cron (recommended) or run manually.
-- pg_cron example (enable the extension first):
--   SELECT cron.schedule('cleanup-expired-tokens', '0 3 * * *',
--     'DELETE FROM token_blacklist WHERE expires_at < now()');
--
-- Or add a one-off cleanup:
DELETE FROM token_blacklist WHERE expires_at < now();

-- ── H2: Password reset cleanup ───────────────────────────────────
-- pg_cron example:
--   SELECT cron.schedule('cleanup-expired-resets', '0 3 * * *',
--     'DELETE FROM password_resets WHERE expires_at < now()');
--
-- One-off:
DELETE FROM password_resets WHERE expires_at < now();
