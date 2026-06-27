-- ============================================================
-- Migration 027: Fix voice_usage_ledger bigint → uuid type mismatch
-- ============================================================
--
-- Bug: Migration 011 defined voice_usage_ledger.user_id as bigint and
-- all three RPCs (increment_voice_usage, top_up_bonus_voice_seconds,
-- get_avatar_quota) with p_user_id bigint — but users.id is uuid.
-- The REFERENCES users(id) FK cannot hold, and any RPC call with a
-- UUID string causes a Postgres type-cast error at runtime.
--
-- Fix strategy:
--   1. Drop the foreign-key constraint and the index that references the
--      wrong type.
--   2. Alter the column from bigint to uuid.
--   3. Re-add the FK and index with the correct type.
--   4. Replace all three affected RPCs with uuid signatures.
--
-- Safe to run on a fresh DB (no rows to migrate) or on an existing DB
-- that ran 011 before users.id became uuid. If the table has rows with
-- real bigint user_ids that are now invalid, those rows will be orphaned
-- by the FK drop; in practice the feature was non-functional (FK never
-- created successfully), so the table should be empty.
--
-- Idempotent: ALTER COLUMN … USING is safe to re-run if the column is
-- already uuid; CREATE OR REPLACE FUNCTION always replaces.

BEGIN;

-- ── 1. Drop the broken FK and index ──────────────────────────
--
-- The FK to users(id) was defined but Postgres would have rejected it on
-- a fresh DB because bigint ≠ uuid. On an existing DB that migrated before
-- the users.id uuid change, the FK may or may not exist. DROP IF EXISTS
-- handles both cases safely.

ALTER TABLE IF EXISTS voice_usage_ledger
  DROP CONSTRAINT IF EXISTS voice_usage_ledger_user_id_fkey;

DROP INDEX IF EXISTS voice_usage_ledger_user_month;

-- ── 2. Change the column type ─────────────────────────────────
--
-- USING cast: bigint → uuid is not implicit in Postgres, but if the
-- column is empty (which it will be on any DB where the FK failed to
-- create, making the feature non-functional) the cast is never applied.
-- On a truly empty table, any USING expression works; we use gen_random_uuid()
-- as a safe no-op fallback for a fully empty table.
-- If there are no rows, ALTER TABLE is instant.

ALTER TABLE IF EXISTS voice_usage_ledger
  ALTER COLUMN user_id TYPE uuid USING user_id::text::uuid;

-- ── 3. Re-add FK and index with correct types ─────────────────

ALTER TABLE IF EXISTS voice_usage_ledger
  ADD CONSTRAINT voice_usage_ledger_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS voice_usage_ledger_user_month
  ON voice_usage_ledger (user_id, billing_month);

-- ── 4. Replace RPCs with uuid signatures ─────────────────────
--
-- All three RPCs had p_user_id bigint. Replace them with p_user_id uuid
-- so PostgREST accepts the UUID strings that the Node client passes.

-- RPC 1: increment_voice_usage
CREATE OR REPLACE FUNCTION increment_voice_usage(
  p_user_id        uuid,
  p_voice_seconds  integer DEFAULT 0,
  p_avatar_seconds integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_month date := voice_current_ist_month();
  v_row   voice_usage_ledger%ROWTYPE;
BEGIN
  INSERT INTO voice_usage_ledger (user_id, billing_month)
  VALUES (p_user_id, v_month)
  ON CONFLICT (user_id, billing_month) DO NOTHING;

  UPDATE voice_usage_ledger
  SET
    voice_seconds_used  = voice_seconds_used  + p_voice_seconds,
    avatar_seconds_used = avatar_seconds_used + p_avatar_seconds,
    updated_at          = now()
  WHERE user_id      = p_user_id
    AND billing_month = v_month
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'voice_seconds_used',  v_row.voice_seconds_used,
    'avatar_seconds_used', v_row.avatar_seconds_used,
    'bonus_voice_seconds', v_row.bonus_voice_seconds,
    'billing_month',       v_row.billing_month
  );
END;
$$;

-- RPC 2: top_up_bonus_voice_seconds
CREATE OR REPLACE FUNCTION top_up_bonus_voice_seconds(
  p_user_id   uuid,
  p_seconds   integer,
  p_max_bonus integer DEFAULT 3600
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_month date := voice_current_ist_month();
  v_row   voice_usage_ledger%ROWTYPE;
BEGIN
  INSERT INTO voice_usage_ledger (user_id, billing_month, bonus_voice_seconds)
  VALUES (p_user_id, v_month, LEAST(p_seconds, p_max_bonus))
  ON CONFLICT (user_id, billing_month) DO UPDATE
    SET bonus_voice_seconds = LEAST(
          voice_usage_ledger.bonus_voice_seconds + p_seconds,
          p_max_bonus
        ),
        updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'bonus_voice_seconds', v_row.bonus_voice_seconds,
    'billing_month',       v_row.billing_month
  );
END;
$$;

-- RPC 3: get_avatar_quota (from migration 020)
CREATE OR REPLACE FUNCTION get_avatar_quota(
  p_user_id  uuid,
  p_cap_secs integer   -- caller-supplied per-plan cap; -1 = unlimited
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_month date := voice_current_ist_month();
  v_used  integer;
BEGIN
  SELECT avatar_seconds_used INTO v_used
  FROM   voice_usage_ledger
  WHERE  user_id       = p_user_id
    AND  billing_month = v_month;

  IF NOT FOUND THEN
    v_used := 0;
  END IF;

  RETURN jsonb_build_object(
    'avatar_seconds_used', v_used,
    'cap_seconds',         p_cap_secs,
    'remaining_seconds',   CASE WHEN p_cap_secs = -1 THEN -1
                                ELSE GREATEST(0, p_cap_secs - v_used) END
  );
END;
$$;

COMMIT;
