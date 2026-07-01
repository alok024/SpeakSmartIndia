/**
 * Speech-to-text controller.
 *
 * POST /api/voice/stt
 * Accepts a WAV audio blob (multipart/form-data, field name "audio").
 * Returns { transcript: string }.
 *
 * Provider chain:
 *   1. Groq Whisper-large-v3   ($0.001/min — ~50× cheaper than Sarvam STT,
 *                                200-300 ms faster)
 *   2. Sarvam Saarika v2.5     (better Indian accent accuracy, circuit-breaker
 *                                fallback when Groq STT is down)
 *
 * The Groq STT circuit breaker is in-process (see groq-stt-breaker.ts).
 * After THRESHOLD consecutive Groq failures the breaker opens and all STT
 * requests route directly to Sarvam until Groq recovers.
 *
 * Voice quota debit: STT duration is debited from the same shared voice
 * pool as TTS (voice_seconds_used). Estimate: 1 s of speech ≈ 1 s of quota.
 * The debit is fire-and-forget — a failed debit call never blocks the response.
 */

import { Request, Response } from 'express';
import { asyncHandler }      from '../../core/middleware';
import { env }               from '../../core/config/env';
import { ok, fail, badRequest } from '../../core/utils/response';
import { logger }            from '../../infra/logger';
import { debitVoiceSeconds } from './voice.ledger';
import { groqAgent, sarvamAgent } from '../../infra/http-agents';
import { recordVoiceLatency }     from '../../infra/voice-latency';
import { agentFetch }             from '../../infra/agent-fetch';
import {
  sttBreakerAvailable,
  sttBreakerSuccess,
  sttBreakerFailure,
} from '../../infra/groq-stt-breaker';

const log = logger.child({ module: 'stt' });

// ─── Groq Whisper STT ─────────────────────────────────────────────────────────

async function transcribeWithGroq(audioBlob: Blob, mimeType: string): Promise<string | null> {
  const form = new FormData();
  form.append('file', audioBlob, `audio.${mimeType === 'audio/wav' ? 'wav' : 'webm'}`);
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'json');
  // Hint the model toward Indian-English to reduce substitution errors on
  // Indian-accented speech. Not a hard constraint — Whisper auto-detects
  // language; this biases the decoder toward en transcription.
  form.append('language', 'en');

  let res: globalThis.Response;
  try {
    const t0 = Date.now();
    res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(8_000),
    });
    recordVoiceLatency('stt', 'groq', Date.now() - t0);
  } catch (err) {
    log.warn('Groq STT network error', { error: (err as Error).message });
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.warn('Groq STT non-ok response', { status: res.status, body: body.slice(0, 200) });
    return null;
  }

  try {
    const json = await res.json() as { text?: string };
    return json.text?.trim() ?? null;
  } catch (err) {
    log.warn('Groq STT JSON parse error', { error: (err as Error).message });
    return null;
  }
}

// ─── Sarvam Saarika STT fallback ─────────────────────────────────────────────

async function transcribeWithSarvam(audioBlob: Blob): Promise<string | null> {
  if (!env.SARVAM_API_KEY) return null;

  const form = new FormData();
  form.append('file', audioBlob, 'audio.wav');
  form.append('model', 'saarika:v2.5');
  form.append('language_code', 'en-IN');

  let res: globalThis.Response;
  try {
    const t0 = Date.now();
    res = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: { 'api-subscription-key': env.SARVAM_API_KEY },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    recordVoiceLatency('stt', 'sarvam', Date.now() - t0);
  } catch (err) {
    log.warn('Sarvam STT network error', { error: (err as Error).message });
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.warn('Sarvam STT non-ok response', { status: res.status, body: body.slice(0, 200) });
    return null;
  }

  try {
    const json = await res.json() as { transcript?: string };
    return json.transcript?.trim() ?? null;
  } catch (err) {
    log.warn('Sarvam STT JSON parse error', { error: (err as Error).message });
    return null;
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export const speechToText = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  // multer populates req.file; validate before touching it
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) {
    badRequest(res, 'audio field is required (multipart/form-data)', 'audio_required');
    return;
  }

  if (file.size > 25 * 1024 * 1024) {
    badRequest(res, 'audio file exceeds 25 MB limit', 'audio_too_large');
    return;
  }

  const mimeType   = file.mimetype || 'audio/wav';
  const audioBlob  = new Blob([file.buffer], { type: mimeType });
  // Rough duration estimate: WAV ≈ 32 kB/s (16-bit 16 kHz mono)
  const estDurSecs = Math.max(1, Math.round(file.size / 32_000));

  let transcript: string | null = null;
  let provider:   'groq' | 'sarvam' = 'groq';

  if (sttBreakerAvailable()) {
    transcript = await transcribeWithGroq(audioBlob, mimeType);
    if (transcript !== null) {
      sttBreakerSuccess();
    } else {
      sttBreakerFailure();
      log.info('Groq STT failed — falling back to Sarvam');
      provider   = 'sarvam';
      transcript = await transcribeWithSarvam(audioBlob);
    }
  } else {
    log.info('Groq STT breaker open — routing to Sarvam');
    provider   = 'sarvam';
    transcript = await transcribeWithSarvam(audioBlob);
  }

  if (!transcript) {
    fail(res, 502, 'stt_failed', 'Speech recognition failed. Please try again.');
    return;
  }

  // Debit voice quota for STT duration (shared pool with TTS)
  debitVoiceSeconds(userId, estDurSecs, 'voice');

  log.info('STT completed', { provider, chars: transcript.length, estDurSecs });
  ok(res, { transcript, provider });
});
