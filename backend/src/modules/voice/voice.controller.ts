import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { env } from '../../core/config/env';
import { badRequest, fail } from '../../core/utils/response';

// POST /api/voice/tts
// Body: { text: string }
// Returns: audio/mpeg stream from ElevenLabs.
// If ELEVENLABS_API_KEY is not configured, returns 501 so the
// frontend can fall back to the browser's built-in speechSynthesis.
export const textToSpeech = asyncHandler(async (req: Request, res: Response) => {
  const { text } = req.body as { text?: string };

  if (!text || !text.trim()) {
    badRequest(res, 'text is required', 'text_required');
    return;
  }
  if (!env.ELEVENLABS_API_KEY) {
    fail(res, 501, 'voice_not_configured', 'Voice synthesis is not configured on this server.');
    return;
  }

  // ElevenLabs caps input length — trim very long text defensively.
  const clipped = text.slice(0, 2000);

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
        text: clipped,
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
});
