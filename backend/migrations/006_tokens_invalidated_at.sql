-- ============================================================
-- Migration 006: tokens_invalidated_at
--
-- Adds a column that authMiddleware checks to invalidate ALL
-- existing sessions when a user resets their password.
--
-- Previously, password reset only changed the password_hash.
-- Any access token (valid 7d) or refresh token (valid 30d)
-- issued before the reset remained usable — an attacker with
-- a stolen session could keep accessing the account indefinitely
-- even after the victim changed their password.
--
-- Fix: confirmPasswordReset() now stamps tokens_invalidated_at
-- with the current timestamp. authMiddleware rejects any JWT
-- whose iat (issued-at) is before this timestamp.
--
-- This is O(1) per request (one indexed column read) — cheaper
-- than blacklisting every token individually.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tokens_invalidated_at timestamptz DEFAULT NULL;

-- Index for the authMiddleware lookup: getUserById already
-- fetches the full user row, so no additional index is needed.
-- The column is NULL for all existing users (no sessions invalidated).
