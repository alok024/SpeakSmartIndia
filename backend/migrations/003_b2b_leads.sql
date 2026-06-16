-- ============================================================
-- B2B Demo Request Leads — Supabase migration (v1)
-- ============================================================

CREATE TABLE IF NOT EXISTS b2b_leads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text NOT NULL,
  org         text NOT NULL,
  size        text NOT NULL,
  org_type    text,
  message     text,
  status      text NOT NULL DEFAULT 'new',   -- new | contacted | qualified | closed
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_leads_created_at ON b2b_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_leads_status     ON b2b_leads(status);
