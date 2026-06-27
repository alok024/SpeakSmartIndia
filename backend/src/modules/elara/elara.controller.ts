/**
 * modules/elara/elara.controller.ts
 *
 * Four original handlers + three new ones for session persistence & vocab:
 *
 * POST /api/elara/sessions      — Pro+ — saves conversation scores at end
 * GET  /api/elara/sessions      — Pro+ — returns English Journey history
 * GET  /api/elara/vocab         — Pro+ — returns saved vocab list
 * POST /api/elara/vocab/save    — Pro+ — manually save a word
 * POST /api/elara/vocab/track   — Pro+ — track errors from a message (internal)
 * GET  /api/elara/vocab/prompt  — Pro+ — system prompt injection block
 */

import { Request, Response } from 'express';
import { z }                  from 'zod';
import { asyncHandler }       from '../../core/middleware';
import { ok, badRequest, fail } from '../../core/utils/response';
import { logger }             from '../../infra/logger';
import { db }                 from '../../core/database/client';
import {
  generateDebrief,
  generateAudit,
  type AnswerEntry,
} from './elara.service';
import {
  saveElaraSession,
  getElaraSessions,
  trackVocabErrors,
  clearSessionVocabDedup,
  saveWordManually,
  getVocabList,
  buildVocabSystemPrompt,
  type VocabError,
} from './elara-sessions.service';

const log = logger.child({ module: 'elara' });

// Shared schema for a single answer entry
const AnswerEntrySchema = z.object({
  question:    z.string().min(1).max(500),
  answer:      z.string().min(1).max(3000),
  score:       z.number().min(0).max(10),
  corrections: z.array(z.object({
    wrong:   z.string(),
    correct: z.string(),
    rule:    z.string().optional(),
  })).optional(),
});

// ── POST /api/elara/debrief — Pro+ ────────────────────────────────────────
export const handleDebrief = asyncHandler(async (req: Request, res: Response) => {
  const BodySchema = z.object({
    answers: z.array(AnswerEntrySchema).min(1).max(20),
  });

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, 'Invalid request body', parsed.error.flatten());
    return;
  }

  const user      = req.user!;
  const dbUser    = await db.getUserById(user.id);
  const hindiPref = dbUser?.elara_hindi_pref ?? false;

  try {
    const result = await generateDebrief(parsed.data.answers as AnswerEntry[], hindiPref);
    ok(res, result);
  } catch (err) {
    log.error('generateDebrief failed', { userId: user.id, err });
    fail(res, 500, 'debrief_failed', 'Could not generate session debrief.');
  }
});

// ── POST /api/elara/audit — Elite only ────────────────────────────────────
export const handleAudit = asyncHandler(async (req: Request, res: Response) => {
  const BodySchema = z.object({
    answers: z.array(AnswerEntrySchema).min(1).max(20),
  });

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, 'Invalid request body', parsed.error.flatten());
    return;
  }

  const user      = req.user!;
  const dbUser    = await db.getUserById(user.id);
  const hindiPref = dbUser?.elara_hindi_pref ?? false;

  try {
    const result = await generateAudit(parsed.data.answers as AnswerEntry[], hindiPref);
    ok(res, result);
  } catch (err) {
    log.error('generateAudit failed', { userId: user.id, err });
    fail(res, 500, 'audit_failed', 'Could not generate session audit.');
  }
});

// ── GET /api/elara/prefs — any authed user ────────────────────────────────
export const getElaraPrefs = asyncHandler(async (req: Request, res: Response) => {
  const user   = req.user!;
  const dbUser = await db.getUserById(user.id);
  ok(res, { elara_hindi_pref: dbUser?.elara_hindi_pref ?? false });
});

// ── PATCH /api/elara/prefs — Elite only ──────────────────────────────────
export const updateElaraPrefs = asyncHandler(async (req: Request, res: Response) => {
  const Schema = z.object({ elara_hindi_pref: z.boolean() });
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, 'elara_hindi_pref must be a boolean');
    return;
  }

  const user = req.user!;
  try {
    await db.updateUser(user.id, { elara_hindi_pref: parsed.data.elara_hindi_pref });
    ok(res, { elara_hindi_pref: parsed.data.elara_hindi_pref });
  } catch (err) {
    log.error('updateElaraPrefs failed', { userId: user.id, err });
    fail(res, 500, 'pref_update_failed', 'Could not update Elara preferences.');
  }
});

// ── POST /api/elara/sessions — Pro+ — save conversation scores ────────────
export const handleSaveSession = asyncHandler(async (req: Request, res: Response) => {
  const BodySchema = z.object({
    client_session_id: z.string().uuid(),
    grammar_score:     z.number().min(0).max(10).nullable().optional(),
    fluency_score:     z.number().min(0).max(10).nullable().optional(),
    vocab_score:       z.number().min(0).max(10).nullable().optional(),
    message_count:     z.number().int().min(0),
    mode:              z.string().min(1).max(40),
  });

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, 'Invalid session body', parsed.error.flatten());
    return;
  }

  const { client_session_id, grammar_score, fluency_score, vocab_score, message_count, mode } = parsed.data;
  const userId = req.user!.id;

  // Fire-and-forget — non-fatal by design
  await saveElaraSession(
    userId,
    client_session_id,
    {
      grammar_score: grammar_score ?? null,
      fluency_score: fluency_score ?? null,
      vocab_score:   vocab_score   ?? null,
    },
    message_count,
    mode,
  );

  // Prune the in-memory session vocab dedup set now that this session is done.
  // Prevents unbounded growth in long-running processes (Bug 5 fix companion).
  clearSessionVocabDedup(userId, client_session_id);

  ok(res, { saved: true });
});

// ── GET /api/elara/sessions — Pro+ — English Journey history ──────────────
export const handleGetSessions = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? 60), 10), 120);
  const history = await getElaraSessions(req.user!.id, isNaN(limit) ? 60 : limit);
  ok(res, { sessions: history });
});

// ── GET /api/elara/vocab — Pro+ — saved vocab list ────────────────────────
export const handleGetVocab = asyncHandler(async (req: Request, res: Response) => {
  const words = await getVocabList(req.user!.id);
  ok(res, { words });
});

// ── POST /api/elara/vocab/save — Pro+ — manually save a word ─────────────
export const handleSaveVocabWord = asyncHandler(async (req: Request, res: Response) => {
  const BodySchema = z.object({
    wrong_form:   z.string().min(1).max(200),
    correct_form: z.string().min(1).max(200),
    rule:         z.string().max(300).optional(),
  });

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, 'Invalid word body', parsed.error.flatten());
    return;
  }

  await saveWordManually(
    req.user!.id,
    parsed.data.wrong_form,
    parsed.data.correct_form,
    parsed.data.rule,
  );

  ok(res, { saved: true });
});

// ── POST /api/elara/vocab/track — Pro+ — track errors from a message ──────
// Called by the /english page after each AI response that contains errors.
// Fire-and-forget on the client side — 200 always returns even if tracking fails.
export const handleTrackVocabErrors = asyncHandler(async (req: Request, res: Response) => {
  const BodySchema = z.object({
    // session_id ties this tracking call to a conversation for the per-session
    // dedup (Bug 5 fix). Clients should pass the same UUID they use for
    // client_session_id throughout a conversation. Falls back to a per-request
    // UUID if omitted (preserves 200 response — tracking never breaks chat).
    session_id: z.string().uuid().optional(),
    errors: z.array(z.object({
      wrong:   z.string().min(1).max(200),
      correct: z.string().min(1).max(200),
      rule:    z.string().max(300).optional(),
    })).min(1).max(10),
  });

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    // Return 200 anyway — tracking must never break the conversation
    ok(res, { tracked: false });
    return;
  }

  const sessionId = parsed.data.session_id ?? crypto.randomUUID();

  // Non-blocking. Cast needed: Zod infers string fields as optional in object
  // types, but min(1) guarantees presence — same pattern as pre-existing handlers.
  trackVocabErrors(req.user!.id, parsed.data.errors as VocabError[], sessionId)
    .catch(err => log.warn('trackVocabErrors fire-and-forget failed', { error: String(err) }));

  ok(res, { tracked: true });
});

// ── GET /api/elara/vocab/prompt — Pro+ — system prompt block ──────────────
// The /english page calls this once at conversation start to inject the user's
// top-10 weak words into the system prompt.
export const handleVocabPrompt = asyncHandler(async (req: Request, res: Response) => {
  const block = await buildVocabSystemPrompt(req.user!.id);
  ok(res, { prompt_block: block });
});

