import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authMiddleware, requireVerified, requireVoiceTier, validate } from '../../core/middleware';
import {
  textToSpeech,
  textToSpeechWarmup,
  getVoiceSettings,
  updateVoiceSettings,
  freeTtsGate,
  freeTtsDebit,
  avatarSessionStart,
  avatarSessionEnd,
} from './voice.controller';
import { speechToText }                    from './stt.controller';
import { requireVoiceQuota, requireAvatarQuota } from './voice.ledger';

// Audio upload: memory storage, 25 MB cap — WAV blobs from a ~60s utterance
// at 16-bit 16 kHz mono are ~1.9 MB; 25 MB gives plenty of headroom for
// longer utterances or higher sample rates without exposing a DoS vector.
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/wav', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4'];
    cb(null, allowed.includes(file.mimetype));
  },
});

const router = Router();

// 30 TTS calls/minute per IP — generous for legitimate use, blocks script abuse
const ttsLimiter = rateLimit({
  windowMs: 60_000,
  max:      30,
  message:  { error: 'Too many TTS requests. Please wait a moment.' },
});

// Separate, tighter limiter for the free-tier warm-up route — it's
// already capped to once/day per user server-side (see the Redis check
// in voice.controller.ts), this is just defence against retry storms.
const warmupLimiter = rateLimit({
  windowMs: 60_000,
  max:      5,
  message:  { error: 'Too many requests. Please wait a moment.' },
});

// Free TTS gate + debit — 120/min per IP (generous; client fires once per question)
const freeTtsLimiter = rateLimit({
  windowMs: 60_000,
  max:      120,
  message:  { error: 'Too many requests. Please wait a moment.' },
});

// Multi-language interview mode — Sarvam's Bulbul v3 caps at 2500 chars
// (vs ElevenLabs' 2000); the controller clips per-engine, this schema
// just needs to allow the larger of the two through.
const TtsSchema = z.object({
  text: z.string().min(1).max(2500),
  lang: z.enum(['en', 'hi', 'hinglish']).optional(),
});

const WarmupSchema = z.object({
  text: z.string().min(1).max(2500), // controller clips to ~450 chars regardless
});

const FreeTtsGateSchema = z.object({
  chars: z.number().int().positive(),
});

const FreeTtsDebitSchema = z.object({
  chars: z.number().int().positive(),
});

const VoiceSettingsPatchSchema = z.object({
  hd_voice_enabled: z.boolean(),
});

// ── Avatar schemas ───────────────────────────────────────────────────────────

const AvatarStartSchema = z.object({
  // Optional metadata — not trusted for billing; informational for gate response only.
  expected_duration_secs: z.number().int().positive().optional(),
});

const AvatarEndSchema = z.object({
  // Actual WebRTC session duration — debited from the avatar pool.
  duration_secs: z.number().int().positive(),
});

// ── Routes ───────────────────────────────────────────────────────────────────

router.post('/tts',
  authMiddleware,
  requireVerified,
  requireVoiceTier,  // 🔒 Starter/Pro/Elite — free users get browser speechSynthesis
  requireVoiceQuota, // 🔒 monthly Sarvam voice-minute cap (ledger gate — migration 011)
  ttsLimiter,
  validate(TtsSchema),
  textToSpeech,
);

// Voice "warm-up" — Available to Free-tier users too (intentionally no
// requireVoiceTier), gated instead by a once-per-IST-day Redis check inside
// the controller.
router.post('/tts/warmup',
  authMiddleware,
  requireVerified,
  warmupLimiter,
  validate(WarmupSchema),
  textToSpeechWarmup,
);

// Voice settings — GET returns current preference + quota info for any plan.
// PATCH requires requireVoiceTier (paid users only — free users can't toggle HD).
router.get('/settings',
  authMiddleware,
  requireVerified,
  getVoiceSettings,
);

router.patch('/settings',
  authMiddleware,
  requireVerified,
  requireVoiceTier,
  validate(VoiceSettingsPatchSchema),
  updateVoiceSettings,
);

// Free TTS gate — checked before client calls window.speechSynthesis.speak()
router.post('/free-tts-gate',
  authMiddleware,
  requireVerified,
  freeTtsLimiter,
  validate(FreeTtsGateSchema),
  freeTtsGate,
);

// Free TTS debit — called on utterance.onend (fire-and-forget from client)
router.post('/free-tts-debit',
  authMiddleware,
  requireVerified,
  freeTtsLimiter,
  validate(FreeTtsDebitSchema),
  freeTtsDebit,
);

// ── Avatar (Simli) quota routes ──────────────────────────────────────────────

// POST /api/voice/avatar/start
// Gate check before opening a Simli WebRTC connection. Returns remaining
// avatar seconds so the client can schedule self-termination when balance
// hits zero. Free users are blocked by requireVoiceTier (belt-and-suspenders
// — the avatar toggle never appears in the free UI anyway).
router.post('/avatar/start',
  authMiddleware,
  requireVerified,
  requireVoiceTier,    // Starter+ only
  requireAvatarQuota,  // monthly avatar cap gate
  ttsLimiter,          // reuse TTS rate limiter — same call frequency profile
  validate(AvatarStartSchema),
  avatarSessionStart,
);

// POST /api/voice/avatar/end
// Debits actual WebRTC session duration. Called by:
//   1. Client onunload / manual avatar toggle-off
//   2. Client self-termination timer (countdown from auto_end_after_secs)
//   3. Any server-push "avatar_session_ended" handler on the client
// Fire-and-forget: always returns 200.
router.post('/avatar/end',
  authMiddleware,
  requireVerified,
  validate(AvatarEndSchema),
  avatarSessionEnd,
);

// ── Speech-to-text ───────────────────────────────────────────────────────────

// 20 STT calls/minute per IP — one per user utterance at natural speaking pace.
const sttLimiter = rateLimit({
  windowMs: 60_000,
  max:      20,
  message:  { error: 'Too many STT requests. Please wait a moment.' },
});

// POST /api/voice/stt
// Body: multipart/form-data, field "audio" (WAV or WebM blob)
// Returns: { transcript: string, provider: 'groq' | 'sarvam' }
// Gated behind Starter+ (free users get Web Speech API — zero server cost).
router.post('/stt',
  authMiddleware,
  requireVerified,
  requireVoiceTier,    // Starter+ only — free users use Web Speech API
  requireVoiceQuota,   // shared voice-second pool
  sttLimiter,
  audioUpload.single('audio'),
  speechToText,
);

export default router;
