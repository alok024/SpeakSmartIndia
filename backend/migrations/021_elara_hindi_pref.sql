-- Migration 021: Elara Hindi/Hinglish explanation preference (Elite only)
-- Matches the pattern of 019_free_tts_and_hd_voice_pref.sql.
-- A boolean column on the users table is the right fit: this is a per-user
-- display preference, not a per-session setting. No RPC needed — the backend
-- reads/writes it via standard PostgREST PATCH on /users.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS elara_hindi_pref BOOLEAN NOT NULL DEFAULT false;
