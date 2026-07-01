import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { env } from '../../core/config/env';
import { badRequest, fail, ok } from '../../core/utils/response';
import { getRedis } from '../../infra/queue/redis';
import { logger } from '../../infra/logger';
import { debitVoiceSeconds, debitAvatarSeconds } from './voice.ledger';
import { db } from '../../core/database/client';
import {
  checkBreaker,
  recordSuccess,
  recordFailure,
} from '../../infra/sarvam-circuit-breaker';
import { sarvamAgent, elevenLabsAgent } from '../../infra/http-agents';
import { recordVoiceLatency } from '../../infra/voice-latency';
import { agentFetch } from '../../infra/agent-fetch';

const log = logger.child({ module: 'voice' });

type VoiceLang = 'en' | 'hi' | 'hinglish';

// Shared ElevenLabs call — used by both the full Pro/Elite TTS route and
// the free-tier warm-up route below. Streams the response straight
// through to `res` rather than buffering, same as the original /tts
// handler.
//
// Returns true if audio was successfully written to `res`, false if the
// upstream failed and an error response was written instead. Mirrors the
// contract of streamSarvamSpeech so callers can use the return value
// directly rather than inspecting res.writableEnded (which is true for
// both success and failure and therefore cannot distinguish them).
async function streamElevenLabsSpeech(res: Response, text: string): Promise<boolean> {
  const t0    = Date.now();
  const elRes = await agentFetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': env.ELEVENLABS_API_KEY,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      agent: elevenLabsAgent,
    }
  );
  recordVoiceLatency('tts', 'elevenlabs', Date.now() - t0);

  if (!elRes.ok) {
    fail(res, 502, 'tts_upstream_failed', 'The text-to-speech service failed to respond.');
    return false;
  }

  const audioBuffer = await elRes.arrayBuffer();

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.write(Buffer.from(audioBuffer));
  res.end();
  return true;
}

// Sarvam Bulbul v3 — Hindi/Hinglish voice (Multi-language interview mode).
// ElevenLabs above doesn't handle Hindi/Hinglish (code-mixed) text well;
// Bulbul v3 is purpose-built for it. API: POST /text-to-speech, response
// is JSON with a base64-encoded WAV in `audios[0]` (not a byte stream),
// so this buffers and decodes rather than piping like the ElevenLabs path.
// See https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/text-to-speech/rest-api
//
// When env.SARVAM_PRIMARY=true, this function is also called for English
// with lang_code=en-IN (Indian-English accent on Bulbul v3).
//
// Returns true if it successfully wrote the response, false if the
// caller should fall back to another engine. On false, this function is
// guaranteed not to have written anything to `res` yet — safe to retry
// with a different engine.
async function streamSarvamSpeech(res: Response, text: string, langCode: string): Promise<boolean> {
  if (!env.SARVAM_API_KEY) return false;

  const t0 = Date.now();
  let sarvamRes: Awaited<ReturnType<typeof agentFetch>>;
  try {
    sarvamRes = await agentFetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': env.SARVAM_API_KEY,
      },
      body: JSON.stringify({
        text,
        target_language_code: langCode,
        model:   env.SARVAM_TTS_MODEL,
        speaker: env.SARVAM_TTS_SPEAKER,
      }),
      agent: sarvamAgent,
    });
  } catch (err) {
    log.warn('Sarvam TTS request failed — falling back', { error: (err as Error).message });
    return false;
  }
  recordVoiceLatency('tts', 'sarvam', Date.now() - t0);

  if (!sarvamRes.ok) {
    const errBody = await sarvamRes.text().catch(() => '');
    log.warn('Sarvam TTS returned an error — falling back', {
      status: sarvamRes.status, error: errBody.slice(0, 300),
    });
    return false;
  }

  let audioBase64: string | undefined;
  try {
    const json = await sarvamRes.json() as { audios?: string[] };
    audioBase64 = json.audios?.[0];
  } catch (err) {
    log.warn('Sarvam TTS response was not valid JSON — falling back', { error: (err as Error).message });
    return false;
  }

  if (!audioBase64) {
    log.warn('Sarvam TTS returned no audio — falling back');
    return false;
  }

  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'no-store');
  res.end(Buffer.from(audioBase64, 'base64'));
  return true;
}

// Picks the right engine for the requested language, consulting the Sarvam
// circuit breaker before attempting a Sarvam call.
//
// Returns true if audio was successfully streamed to `res`, false if an
// error response was written instead (e.g. both engines failed). The caller
// uses this to decide whether to debit the voice ledger — a failed upstream
// call must never burn the user's quota.
//
// SARVAM_PRIMARY defaults to true as of 2026-06 (Sarvam is now the
// primary voice engine for all languages, English included):
// All languages try Sarvam first. English uses lang_code=en-IN (Indian-English
// accent on Bulbul v3). ElevenLabs is the fallback if Sarvam fails or is
// down. The circuit breaker short-circuits the Sarvam attempt during an
// outage so users don't pay Sarvam's failure latency on every call.
//
// When SARVAM_PRIMARY=false (legacy, opt-out):
// English always uses ElevenLabs. Hindi/Hinglish try Sarvam first, falling
// back to ElevenLabs. No circuit breaker on this path (non-primary).
async function synthesizeSpeech(res: Response, text: string, lang: VoiceLang): Promise<boolean> {
  if (env.SARVAM_PRIMARY) {
    // Consult the breaker before making the Sarvam call
    const decision = await checkBreaker();

    if (decision.state === 'open') {
      // Breaker is open — Sarvam is known-down; skip straight to ElevenLabs.
      // streamElevenLabsSpeech now returns a boolean success flag; use it
      // directly rather than inspecting res.writableEnded, which is true in
      // both the success and failure cases and cannot distinguish them.
      log.info('Sarvam-primary: breaker open — skipping Sarvam, using ElevenLabs', { lang });
      return streamElevenLabsSpeech(res, text.slice(0, 2000));
    }

    const langCode = lang === 'en' ? env.SARVAM_EN_LANG_CODE : 'hi-IN';
    const handled  = await streamSarvamSpeech(res, text, langCode);

    if (handled) {
      // Success — reset the failure counter (works for both closed and half_open_probe)
      await recordSuccess();
      return true;
    }

    // Sarvam failed — record the failure (may trip the breaker)
    await recordFailure();

    log.info('Sarvam-primary: falling back to ElevenLabs', {
      lang,
      wasProbe: decision.state === 'half_open_probe',
    });
    // Re-clip: text was sized for Sarvam's 2500-char limit; ElevenLabs
    // only accepts 2000. A 2500-char input causes a 400/422 upstream.
    return streamElevenLabsSpeech(res, text.slice(0, 2000));
  }

  // Legacy path: ElevenLabs primary for English, Sarvam primary for hi/hinglish
  if (lang !== 'en') {
    const handled = await streamSarvamSpeech(res, text, 'hi-IN');
    if (handled) return true;
    log.info('Falling back to ElevenLabs for non-English TTS request', { lang });
  }
  return streamElevenLabsSpeech(res, text);
}

// POST /api/voice/tts
// Body: { text: string, lang?: 'en' | 'hi' | 'hinglish' }
// Returns: an audio stream (audio/mpeg via ElevenLabs for English,
// audio/wav via Sarvam for Hindi/Hinglish).
// If neither provider is configured for the requested language, returns
// 501 so the frontend can fall back to the browser's built-in speechSynthesis.
export const textToSpeech = asyncHandler(async (req: Request, res: Response) => {
  const { text, lang = 'en' } = req.body as { text?: string; lang?: VoiceLang };
  const userId = req.user!.id;

  if (!text || !text.trim()) {
    badRequest(res, 'text is required', 'text_required');
    return;
  }
  if (!env.ELEVENLABS_API_KEY && !(lang !== 'en' && env.SARVAM_API_KEY) && !(env.SARVAM_PRIMARY && env.SARVAM_API_KEY)) {
    fail(res, 501, 'voice_not_configured', 'Voice synthesis is not configured on this server.');
    return;
  }

  // Clip to the primary engine's limit. When SARVAM_PRIMARY is true, all
  // languages (English included) go to Sarvam first (2500-char limit).
  // When SARVAM_PRIMARY is false, English goes directly to ElevenLabs (2000-char
  // limit). The Sarvam→ElevenLabs fallback inside synthesizeSpeech re-clips
  // to 2000 at the actual call site, so we don't under-serve Sarvam by
  // pre-clipping English to ElevenLabs' lower limit here.
  const clipped = text.slice(0, env.SARVAM_PRIMARY
    ? 2500                        // Sarvam Bulbul v3 limit (all langs)
    : lang === 'en' ? 2000 : 2500 // legacy: ElevenLabs for en, Sarvam for hi
  );
  const streamed = await synthesizeSpeech(res, clipped, lang);

  // Only debit if audio was actually streamed — a failed upstream call
  // (both engines down) must never burn the user's monthly quota.
  if (streamed) {
    // Estimate: ~0.05 s of speech per character (natural English pace ≈ 140 wpm,
    // ~5 chars/word → 700 chars/min → 1 char ≈ 86 ms; we use 50 ms as a
    // conservative estimate that holds for faster-paced Hindi/Hinglish too).
    const estimatedSecs = Math.max(1, Math.round(clipped.length * 0.05));
    debitVoiceSeconds(userId, estimatedSecs, 'voice');
  }
});

// Voice "warm-up"md).
// Lets a Free-tier user hear ~30s of Aria/Elara's HD voice once a day,
// as a taste of the paid voice feature, without requiring requireVoiceTier.
//
// Safeguards (reusing existing infra only — no new schema/table):
// - Hard character cap (~450 chars ≈ 30s of speech at natural pace)
// regardless of what the client sends.
// - Once-per-IST-calendar-day per user, tracked as a single Redis key
// with a TTL — same pattern as the prompt-context cache in
// ai.prompt-service.ts. Redis unavailable → fails open (allows the
// request) rather than blocking a legitimate free-tier user; this
// mirrors the burst-limiter's fail-open behaviour.
const WARMUP_CHAR_CAP = 450;
const WARMUP_KEY = (userId: string) => {
  const istDate = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `voice:warmup:${userId}:${istDate}`;
};

export const textToSpeechWarmup = asyncHandler(async (req: Request, res: Response) => {
  const { text } = req.body as { text?: string };
  const userId = req.user!.id;

  if (!text || !text.trim()) {
    badRequest(res, 'text is required', 'text_required');
    return;
  }
  if (!env.ELEVENLABS_API_KEY) {
    fail(res, 501, 'voice_not_configured', 'Voice synthesis is not configured on this server.');
    return;
  }

  const redis = getRedis();
  let warmupKeySet: string | null = null;
  if (!redis) {
    // Redis is required to enforce the once-per-day free cap.
    // Allowing through when Redis is down lets free users get unlimited
    // warmup calls during any outage. Fail closed instead.
    fail(res, 503, 'voice_warmup_unavailable', 'Voice preview is temporarily unavailable. Please try again shortly.');
    return;
  }
  try {
    const key = WARMUP_KEY(userId);
    const alreadyUsed = await redis.get(key);
    if (alreadyUsed) {
      fail(res, 429, 'warmup_already_used', "You've already heard today's free voice preview — upgrade to Pro for unlimited HD voice.");
      return;
    }
    // Set the flag before streaming so a slow/aborted response can't be
    // retried into multiple free plays — set first, stream second.
    await redis.set(key, '1', 'EX', 26 * 60 * 60); // a little over 24h, covers IST/UTC date-boundary skew
    warmupKeySet = key;
  } catch (err) {
    log.warn('Voice warm-up: Redis check failed — blocking request (fail-closed)', {
      userId, error: (err as Error).message,
    });
    fail(res, 503, 'voice_warmup_unavailable', 'Voice preview is temporarily unavailable. Please try again shortly.');
    return;
  }

  const clipped = text.slice(0, WARMUP_CHAR_CAP);
  try {
    await streamElevenLabsSpeech(res, clipped);
  } catch (err) {
    // a failed TTS call must not permanently burn the user's one
    // daily free preview — roll back the warm-up flag so they can retry.
    if (warmupKeySet && redis) {
      try {
        await redis.del(warmupKeySet);
      } catch (delErr) {
        log.warn('Voice warm-up: failed to roll back flag after TTS failure', {
          userId, error: (delErr as Error).message,
        });
      }
    }
    throw err;
  }
});

// ── Migration 019: Voice settings (HD toggle) + Free TTS gate/debit ──────────

// GET /api/voice/settings
// Returns hd_voice_enabled preference + quota info for the current user.
// Free users: { plan: 'free', chars_used, chars_cap, hd_voice_enabled: false }
// Paid users: { plan, hd_voice_enabled, hd_quota_reset? }
export const getVoiceSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const plan   = req.user!.plan;

  if (plan === 'free') {
    const charsUsed = await db.getFreeTtsCharsUsed(userId).catch(() => 0);
    ok(res, {
      plan,
      hd_voice_enabled: false,
      chars_used: charsUsed,
      chars_cap:  env.FREE_TTS_CHAR_CAP,
      // ISO date of first day of next IST month — when the cap resets
      quota_resets_at: (() => {
        const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
      })(),
    });
    return;
  }

  const [hdEnabled, voiceUsage] = await Promise.all([
    db.getHdVoiceEnabled(userId).catch(() => false),
    db.getVoiceUsage(userId).catch(() => null),
  ]);

  // Sarvam voice balance (Aria + Elara share one pool)
  const planVoiceCaps: Record<string, number> = {
    starter: env.VOICE_CAP_STARTER,
    pro:     env.VOICE_CAP_PRO,
    elite:   env.VOICE_CAP_ELITE,
  };
  const voiceCapSecs  = planVoiceCaps[plan] ?? env.VOICE_CAP_STARTER;
  const voiceUsedSecs = voiceUsage?.voice_seconds_used ?? 0;
  const bonusSecs     = voiceUsage?.bonus_voice_seconds ?? 0;
  const effectiveVoiceCap = voiceCapSecs + bonusSecs;
  const hdExhausted   = voiceUsedSecs >= effectiveVoiceCap;

  // Avatar (Simli) balance — separate pool
  const planAvatarCaps: Record<string, number> = {
    starter: env.AVATAR_CAP_STARTER,
    pro:     env.AVATAR_CAP_PRO,
    elite:   env.AVATAR_CAP_ELITE,
  };
  const avatarCapSecs  = planAvatarCaps[plan] ?? 0;
  const avatarUsedSecs = voiceUsage?.avatar_seconds_used ?? 0;
  const avatarExhausted = avatarCapSecs > 0 && avatarUsedSecs >= avatarCapSecs;

  const nextMonthReset = (() => {
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  })();

  ok(res, {
    plan,
    hd_voice_enabled:            hdEnabled,
    hd_exhausted:                hdExhausted,
    hd_quota_reset:              hdExhausted ? nextMonthReset : null,
    // Sarvam voice balance
    voice_seconds_used:          voiceUsedSecs,
    voice_cap_seconds:           effectiveVoiceCap,
    voice_seconds_remaining:     Math.max(0, effectiveVoiceCap - voiceUsedSecs),
    // Avatar balance — separate pool
    avatar_seconds_used:         avatarUsedSecs,
    avatar_cap_seconds:          avatarCapSecs,
    avatar_seconds_remaining:    avatarCapSecs > 0 ? Math.max(0, avatarCapSecs - avatarUsedSecs) : null,
    avatar_exhausted:            avatarExhausted,
    avatar_quota_reset:          avatarExhausted ? nextMonthReset : null,
  });
});

// PATCH /api/voice/settings
// Body: { hd_voice_enabled: boolean }
// Persists HD voice toggle. Only accessible to paid users (requireVoiceTier on route).
export const updateVoiceSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { hd_voice_enabled } = req.body as { hd_voice_enabled?: boolean };

  if (typeof hd_voice_enabled !== 'boolean') {
    badRequest(res, 'hd_voice_enabled must be a boolean', 'invalid_hd_toggle');
    return;
  }

  await db.setHdVoiceEnabled(userId, hd_voice_enabled);
  ok(res, { hd_voice_enabled });
});

// POST /api/voice/free-tts-gate
// Body: { chars: number }
//
// SOFT CAP — not server-enforced. Web Speech API is browser-native; the server
// cannot intercept or block browser TTS calls. A determined client can skip
// this gate call or ignore `allowed: false` and the browser will still speak.
//
// The REAL enforcement for free users is requireVoiceTier in voice.routes.ts,
// which blocks free users from POST /api/voice/tts (Sarvam HD voice) entirely.
// This gate is a courtesy counter so free users get a clear UI indication when
// their 15-minute Web Speech warm-up is exhausted, not a security boundary.
//
// If a hard cap on free Web Speech is needed in the future, route free users
// through a dedicated server-side TTS endpoint that debits before streaming
// audio back (no client-side speech call at all). See audit notes.
//
// Returns { allowed: boolean, chars_used: number, chars_cap: number }.
// Fails open on DB error so a transient outage never silences a session.
export const freeTtsGate = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { chars } = req.body as { chars?: number };

  if (!chars || typeof chars !== 'number' || chars < 1) {
    badRequest(res, 'chars must be a positive integer', 'invalid_chars');
    return;
  }

  let charsUsed = 0;
  try {
    charsUsed = await db.getFreeTtsCharsUsed(userId);
  } catch {
    // Fail-open: DB error → allow the TTS call
    ok(res, { allowed: true, chars_used: 0, chars_cap: env.FREE_TTS_CHAR_CAP });
    return;
  }

  const allowed = charsUsed + chars <= env.FREE_TTS_CHAR_CAP;
  ok(res, {
    allowed,
    chars_used: charsUsed,
    chars_cap:  env.FREE_TTS_CHAR_CAP,
  });
});

// POST /api/voice/free-tts-debit
// Body: { chars: number }
// Called client-side on utterance.onend — debits chars after speech completes.
// Fire-and-forget: always returns 200, non-fatal on DB error.
//
// Note: this endpoint trusts the client-supplied `chars` value. A client could
// inflate or deflate the count. This is an accepted trade-off: since the
// Web Speech API cannot be intercepted server-side (see freeTtsGate above),
// precise enforcement is not achievable without routing through a server-side
// TTS endpoint. The counter's purpose is UX (showing remaining quota), not
// billing — so client-supplied counts are acceptable at this stage.
export const freeTtsDebit = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { chars } = req.body as { chars?: number };

  if (chars && typeof chars === 'number' && chars > 0) {
    db.incrementFreeTtsChars(userId, chars).catch((err: Error) => {
      log.warn('freeTtsDebit: failed to increment chars', { userId, error: err.message });
    });
  }

  ok(res, { debited: true });
});

// ── Avatar (Simli) session gate + debit ─────────────────────────────────────

// POST /api/voice/avatar/start
// Gate has already passed (requireAvatarQuota). Calls Simli's server-side
// token API so SIMLI_API_KEY never reaches the browser. Returns the
// short-lived session_token alongside remaining quota so the client can
// open the WebRTC connection and schedule self-termination.
// Falls back gracefully when SIMLI_API_KEY is not configured — returns
// simli_unavailable: true so the frontend silently drops to voice-only.
export const avatarSessionStart = asyncHandler(async (req: Request, res: Response) => {
  const remaining = (req as Request & { avatarSecondsRemaining?: number }).avatarSecondsRemaining;

  if (!env.SIMLI_API_KEY || !env.SIMLI_FACE_ID) {
    log.warn('SIMLI_API_KEY / SIMLI_FACE_ID not set — avatar unavailable', {
      userId: req.user?.id,
    });
    ok(res, {
      simli_unavailable:        true,
      avatar_seconds_remaining: remaining ?? null,
      auto_end_after_secs:      remaining ?? null,
      session_token:            null,
      face_id:                  null,
    });
    return;
  }

  // Request a short-lived session token. The token is scoped to one WebRTC
  // session; the API key stays server-side and never reaches the browser.
  let sessionToken: string;
  try {
    const tokenRes = await fetch('https://api.simli.ai/startE2ESession', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey:           env.SIMLI_API_KEY,
        faceId:           env.SIMLI_FACE_ID,
        handleSilence:    true,
        maxSessionLength: Math.min(remaining ?? 600, 600),
        maxIdleTime:      60,
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => '');
      log.error('Simli session token request failed', {
        status: tokenRes.status, body: body.slice(0, 200), userId: req.user?.id,
      });
      ok(res, {
        simli_unavailable:        true,
        avatar_seconds_remaining: remaining ?? null,
        auto_end_after_secs:      remaining ?? null,
        session_token:            null,
        face_id:                  null,
      });
      return;
    }

    const tokenData = await tokenRes.json() as { session_token?: string };
    if (!tokenData.session_token) {
      log.error('Simli token response missing session_token', {
        body: JSON.stringify(tokenData).slice(0, 200), userId: req.user?.id,
      });
      ok(res, {
        simli_unavailable:        true,
        avatar_seconds_remaining: remaining ?? null,
        auto_end_after_secs:      remaining ?? null,
        session_token:            null,
        face_id:                  null,
      });
      return;
    }

    sessionToken = tokenData.session_token;
  } catch (err) {
    log.error('Simli token fetch threw', {
      error: (err as Error).message, userId: req.user?.id,
    });
    ok(res, {
      simli_unavailable:        true,
      avatar_seconds_remaining: remaining ?? null,
      auto_end_after_secs:      remaining ?? null,
      session_token:            null,
      face_id:                  null,
    });
    return;
  }

  ok(res, {
    simli_unavailable:        false,
    session_token:            sessionToken,
    face_id:                  env.SIMLI_FACE_ID,
    avatar_seconds_remaining: remaining ?? null,
    auto_end_after_secs:      remaining ?? null,
  });
});

// POST /api/voice/avatar/end
// Body: { duration_secs: number }
// Debits the actual WebRTC session duration. Called by:
//   1. Client onunload / manual close
//   2. Client self-termination timer (avatar_seconds_remaining countdown)
//   3. Any server-push "avatar_session_ended" event handler on the client
// Always returns 200 — debit is fire-and-forget and must not fail the client.
export const avatarSessionEnd = asyncHandler(async (req: Request, res: Response) => {
  const { duration_secs } = req.body as { duration_secs: number };
  const userId = req.user!.id;

  debitAvatarSeconds(userId, duration_secs);

  ok(res, { debited: true, duration_secs });
});
