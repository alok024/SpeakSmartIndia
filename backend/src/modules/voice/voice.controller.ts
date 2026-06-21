import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { env } from '../../core/config/env';
import { badRequest, fail } from '../../core/utils/response';
import { getRedis } from '../../infra/queue/redis';
import { logger } from '../../infra/logger';

const log = logger.child({ module: 'voice' });

type VoiceLang = 'en' | 'hi' | 'hinglish';

// Shared ElevenLabs call — used by both the full Pro/Elite TTS route and
// the free-tier warm-up route below. Streams the response straight
// through to `res` rather than buffering, same as the original /tts
// handler.
async function streamElevenLabsSpeech(res: Response, text: string): Promise<void> {
  const elRes = await fetch(
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
    }
  );

  if (!elRes.ok || !elRes.body) {
    fail(res, 502, 'tts_upstream_failed', 'The text-to-speech service failed to respond.');
    return;
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');

  const reader = elRes.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

// Sarvam Bulbul v3 — Hindi/Hinglish voice (Multi-language interview mode).
// ElevenLabs above doesn't handle Hindi/Hinglish (code-mixed) text well;
// Bulbul v3 is purpose-built for it. API: POST /text-to-speech, response
// is JSON with a base64-encoded WAV in `audios[0]` (not a byte stream),
// so this buffers and decodes rather than piping like the ElevenLabs path.
// See https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/text-to-speech/rest-api
//
// Returns true if it successfully wrote the response, false if the
// caller should fall back to another engine. On false, this function is
// guaranteed not to have written anything to `res` yet — safe to retry
// with a different engine.
async function streamSarvamSpeech(res: Response, text: string): Promise<boolean> {
  if (!env.SARVAM_API_KEY) return false;

  // `Response` in this file's scope is Express's type (imported above for
  // the `res` parameter) — alias the global Fetch API Response so the
  // Sarvam HTTP call below is typed correctly rather than against Express's.
  let sarvamRes: globalThis.Response;
  try {
    sarvamRes = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': env.SARVAM_API_KEY,
      },
      body: JSON.stringify({
        text,
        // Bulbul v3 handles English-words-inside-Hindi-sentences (Hinglish)
        // natively under hi-IN — there's no separate "hinglish" language
        // code, the model infers the mix from the text itself.
        target_language_code: 'hi-IN',
        model:   env.SARVAM_TTS_MODEL,
        speaker: env.SARVAM_TTS_SPEAKER,
      }),
    });
  } catch (err) {
    log.warn('Sarvam TTS request failed — falling back', { error: (err as Error).message });
    return false;
  }

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

// Picks the right engine for the requested language. English always uses
// ElevenLabs (unchanged behaviour for every existing caller that doesn't
// pass `lang`). Hindi/Hinglish try Sarvam first, falling back to the
// English ElevenLabs voice if Sarvam isn't configured or fails — better
// to speak with the wrong accent than not speak at all.
async function synthesizeSpeech(res: Response, text: string, lang: VoiceLang): Promise<void> {
  if (lang !== 'en') {
    const handled = await streamSarvamSpeech(res, text);
    if (handled) return;
    log.info('Falling back to ElevenLabs for non-English TTS request', { lang });
  }
  await streamElevenLabsSpeech(res, text);
}

// POST /api/voice/tts
// Body: { text: string, lang?: 'en' | 'hi' | 'hinglish' }
// Returns: an audio stream (audio/mpeg via ElevenLabs for English,
// audio/wav via Sarvam for Hindi/Hinglish).
// If neither provider is configured for the requested language, returns
// 501 so the frontend can fall back to the browser's built-in speechSynthesis.
export const textToSpeech = asyncHandler(async (req: Request, res: Response) => {
  const { text, lang = 'en' } = req.body as { text?: string; lang?: VoiceLang };

  if (!text || !text.trim()) {
    badRequest(res, 'text is required', 'text_required');
    return;
  }
  if (!env.ELEVENLABS_API_KEY && !(lang !== 'en' && env.SARVAM_API_KEY)) {
    fail(res, 501, 'voice_not_configured', 'Voice synthesis is not configured on this server.');
    return;
  }

  // Caps mirror each provider's own input limits — ElevenLabs comment
  // unchanged; Sarvam's REST API caps Bulbul v3 at 2500 characters.
  const clipped = text.slice(0, lang === 'en' ? 2000 : 2500);
  await synthesizeSpeech(res, clipped, lang);
});

// Voice "warm-up" — Easy build item (vachix_b2c_build_plan(1).md §2).
// Lets a Free-tier user hear ~30s of Aria/Elara's HD voice once a day,
// as a taste of the Pro voice feature, without requiring requirePro.
//
// Safeguards (reusing existing infra only — no new schema/table):
//   - Hard character cap (~450 chars ≈ 30s of speech at natural pace)
//     regardless of what the client sends.
//   - Once-per-IST-calendar-day per user, tracked as a single Redis key
//     with a TTL — same pattern as the prompt-context cache in
//     ai.prompt-service.ts. Redis unavailable → fails open (allows the
//     request) rather than blocking a legitimate free-tier user; this
//     mirrors the burst-limiter's fail-open behaviour.
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
  if (redis) {
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
      log.warn('Voice warm-up: Redis check failed — allowing request (fail-open)', {
        userId, error: (err as Error).message,
      });
    }
  }

  const clipped = text.slice(0, WARMUP_CHAR_CAP);
  try {
    await streamElevenLabsSpeech(res, clipped);
  } catch (err) {
    // Fix (#7): a failed TTS call must not permanently burn the user's one
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
