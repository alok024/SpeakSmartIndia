-- Migration 015: Weekly Progress Card (P3-B)
--
-- Adds:
--   push_subscriptions  — stores Web Push subscription objects per user.
--                         One user may have multiple devices/browsers.
--   users.weekly_card_url — URL of the last-generated weekly card SVG.
--                           NULL until the first Sunday cron runs for the user.
--
-- Design notes:
--   push_subscriptions is a separate table (not a column on users) because
--   one user realistically has multiple browsers/devices and we want to fan
--   out to all of them. Deleting a subscription (browser unsubscribe) must
--   be possible without touching the users row.
--
--   endpoint is the unique key — Web Push spec guarantees it is unique per
--   subscription. We use it to deduplicate re-subscriptions (same browser,
--   new tab) via ON CONFLICT DO NOTHING.

-- push_subscriptions table
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON push_subscriptions (user_id);

-- weekly_card_url on users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS weekly_card_url TEXT;

-- RLS: deny-by-default (matches 008_rls_default_deny.sql pattern)
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
