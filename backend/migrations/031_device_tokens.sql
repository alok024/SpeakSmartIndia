-- Migration 031: Mobile device tokens (FCM registration storage)
--
-- Adds device_tokens — stores Firebase Cloud Messaging registration tokens
-- for native (iOS/Android) clients, so the upcoming Flutter app has
-- somewhere real to register against instead of the nonexistent
-- /api/notifications/register-device route the original mobile build
-- guide assumed.
--
-- Design notes:
--   This is a separate table from push_subscriptions (015), not a shared
--   one. push_subscriptions stores Web Push subscription objects
--   (endpoint + p256dh + auth keys) — that's the W3C Push API protocol the
--   browser uses. FCM tokens are a single opaque string under a completely
--   different delivery protocol. Forcing both into one table means most
--   columns are null depending on platform; two tables, two protocols.
--
--   Keyed by token, not (user_id, token): the same physical device can
--   log out of one account and into another without uninstalling the
--   app, and the token should follow the device, not pile up stale rows
--   per account. ON CONFLICT (token) re-points an existing row at whoever
--   is logged in now.
--
-- Scope note: this migration is storage only. It makes POST
-- /api/push/register-device functional, but nothing reads from this
-- table to actually send a push yet — that needs the firebase-admin
-- SDK and a Firebase service account credential, which is a separate
-- piece of backend work (see the TODO in push.service.ts).

CREATE TABLE IF NOT EXISTS device_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  platform   TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS device_tokens_user_id_idx
  ON device_tokens (user_id);

-- RLS: deny-by-default (matches 008_rls_default_deny.sql pattern)
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
