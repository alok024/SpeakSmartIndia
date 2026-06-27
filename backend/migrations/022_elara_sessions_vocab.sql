-- Migration 022: Elara session persistence + vocabulary tracker
--
-- elara_sessions: persists grammar/fluency/vocab scores after every Elara
--   conversation for paid-tier users. One row per conversation session.
--   Used by the "English Journey" dashboard chart (week-over-week fluency).
--
-- elara_vocab_words: personal vocabulary list for Pro+ users.
--   Words are auto-saved when Elara flags the same mistake 3+ times across
--   sessions (matched by canonical form). Users can also manually save any
--   word. The top 10 weak words are injected into future Elara system prompts.
--
-- RLS: both tables follow the default-deny pattern from migration 008.
--   Service role only (same as every other table in this codebase).

-- ── elara_sessions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS elara_sessions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- client-generated stable ID for idempotency on retry
  client_session_id TEXT        NOT NULL,
  grammar_score     NUMERIC(4,2),
  fluency_score     NUMERIC(4,2),
  vocab_score       NUMERIC(4,2),
  message_count     INT         NOT NULL DEFAULT 0,
  mode              TEXT        NOT NULL DEFAULT 'conversation',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevent double-insert on client retry
  CONSTRAINT elara_sessions_client_session_id_unique UNIQUE (user_id, client_session_id)
);

CREATE INDEX IF NOT EXISTS elara_sessions_user_created
  ON elara_sessions (user_id, created_at DESC);

-- Enable RLS (default-deny; service role bypasses all policies)
ALTER TABLE elara_sessions ENABLE ROW LEVEL SECURITY;

-- ── elara_vocab_words ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS elara_vocab_words (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The canonical wrong form (e.g. "I am agree") or weak word (e.g. "good")
  wrong_form      TEXT        NOT NULL,
  -- The correct / better alternative
  correct_form    TEXT        NOT NULL,
  -- Optional rule or tip
  rule            TEXT,
  -- How many times flagged across sessions (auto-increment path)
  occurrences     INT         NOT NULL DEFAULT 1,
  -- true = auto-saved by the 3-strike rule; false = manually saved by user
  auto_saved      BOOLEAN     NOT NULL DEFAULT false,
  -- true = manually saved by user tapping the word
  manually_saved  BOOLEAN     NOT NULL DEFAULT false,
  -- last time this word was reinforced in an Elara session prompt
  last_reinforced_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One canonical entry per (user, wrong_form) pair
  CONSTRAINT elara_vocab_words_user_wrong_unique UNIQUE (user_id, wrong_form)
);

CREATE INDEX IF NOT EXISTS elara_vocab_words_user_occ
  ON elara_vocab_words (user_id, occurrences DESC, updated_at DESC);

ALTER TABLE elara_vocab_words ENABLE ROW LEVEL SECURITY;
