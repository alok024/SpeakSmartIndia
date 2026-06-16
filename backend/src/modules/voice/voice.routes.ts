import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authMiddleware, requireVerified, requirePro, validate } from '../../core/middleware';
import { textToSpeech } from './voice.controller';

const router = Router();

// 30 TTS calls/minute per IP — generous for legitimate use, blocks script abuse
const ttsLimiter = rateLimit({
  windowMs: 60_000,
  max:      30,
  message:  { error: 'Too many TTS requests. Please wait a moment.' },
});

const TtsSchema = z.object({
  text: z.string().min(1).max(2000),
});

router.post('/tts',
  authMiddleware,
  requireVerified,
  requirePro,       // 🔒 Pro/Elite only — free users get browser speechSynthesis
  ttsLimiter,
  validate(TtsSchema),
  textToSpeech,
);

export default router;
