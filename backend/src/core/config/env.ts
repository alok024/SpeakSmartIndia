/**
 * Environment configuration — Zod-validated at startup.
 *
 * All required vars cause process.exit(1) with a clear diagnostic if
 * missing or malformed. Numeric and boolean vars are coerced to their
 * native types — no more parseInt() / parseFloat() scattered across modules.
 *
 * Rule: import `env` from this file everywhere.
 *       Never read process.env directly anywhere else.
 */

import { z } from 'zod';

// Schema

const EnvSchema = z.object({

  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT:     z.coerce.number().int().positive().default(3000),

  // app/release version, set at build time (e.g. via Docker ARG/ENV or
  // CI `--build-arg VERSION=$(git rev-parse --short HEAD)`). Replaces direct
  // process.env.npm_package_version reads, which bypass Zod validation and
  // are undefined in most Docker builds.
  VERSION: z.string().default('unknown'),

  // Supabase
  SUPABASE_URL:         z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  // required in production. Falling back to SUPABASE_SERVICE_KEY
  // bypasses Row Level Security on every client-facing query, so this can
  // no longer be silently optional outside of local dev/test. Enforced
  // below via .superRefine() (needs NODE_ENV, which isn't known yet here).
  SUPABASE_ANON_KEY:    z.string().min(1).optional(),

  // Auth
  JWT_SECRET:         z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),

  // secret used to HMAC-sign public report share tokens, preventing
  // anyone from forging a valid token for a session UUID they don't
  // already hold a legitimate token for.
  REPORT_SECRET: z.string().min(32, 'REPORT_SECRET must be at least 32 characters'),

  // AI providers
  GROQ_API_KEY:   z.string().min(1),
  OPENAI_API_KEY: z.string().default(''),

  // Voice (optional — browser TTS fallback when unset)
  ELEVENLABS_API_KEY:  z.string().default(''),
  ELEVENLABS_VOICE_ID: z.string().default('21m00Tcm4TlvDq8ikWAM'),

  // Voice — Hindi/Hinglish (Multi-language interview mode). ElevenLabs
  // above remains the English voice; Sarvam's Bulbul v3 model handles
  // Hindi/Hinglish (code-mixed text) natively, which ElevenLabs does not.
  // Optional — if unset, hi/hinglish TTS requests fall back to the
  // ElevenLabs voice (English-accented, but not a hard failure) and the
  // controller logs a warning so it's visible the Sarvam key is missing.
  SARVAM_API_KEY:      z.string().default(''),
  SARVAM_TTS_SPEAKER:  z.string().default('shubh'),  // valid bulbul:v3 speaker name
  SARVAM_TTS_MODEL:    z.string().default('bulbul:v3'),
  // When set to 'true', Sarvam is used as the primary TTS provider for ALL
  // languages (English included), with ElevenLabs as fallback. When 'false'
  // (default for backwards-compat), ElevenLabs remains primary for English
  // and Sarvam only handles hi/hinglish requests.
  // Feature: "Voice provider switch (Sarvam primary)" ElevenLabs remains the
  // automatic fallback on Sarvam failure (see synthesizeSpeech() in
  // voice.controller.ts). Set to 'false' to revert to ElevenLabs-primary
  // for English without a code change.
  SARVAM_PRIMARY:      z.string().transform(v => v === 'true').default('true'),
  // Sarvam language code for English requests when SARVAM_PRIMARY=true.
  // Bulbul v3 supports en-IN natively for Indian-English accent.
  SARVAM_EN_LANG_CODE: z.string().default('en-IN'),

  // Free-tier Web Speech API cap: ~15 min/month at natural speech pace
  // (~60 chars/s → 54,000 chars/month). Zero cost to us (browser TTS),
  // capped server-side to create a gap vs paid plans.
  FREE_TTS_CHAR_CAP: z.coerce.number().int().positive().default(54_000),

  // Razorpay — live keys (required)
  RAZORPAY_KEY_ID:         z.string().min(1),
  RAZORPAY_KEY_SECRET:     z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),

  // Razorpay — test-mode keys (optional)
  RAZORPAY_TEST_KEY_ID:         z.string().default(''),
  RAZORPAY_TEST_KEY_SECRET:     z.string().default(''),
  RAZORPAY_TEST_WEBHOOK_SECRET: z.string().default(''),

  // URLs
  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL').default('https://vachix.in'),

  // Vercel preview deployments use dynamic subdomain URLs like
  // vachixindia-git-fix-branch-xyz.vercel.app which can't be hardcoded
  // in PROD_ORIGINS. EXTRA_ALLOWED_ORIGINS is a comma-separated list of
  // additional origins to whitelist at runtime — set it in Railway/env to
  // add preview URLs without a code deploy. Examples:
  // EXTRA_ALLOWED_ORIGINS=https://vachixindia-pr-42.vercel.app
  // EXTRA_ALLOWED_ORIGINS=https://preview.vachix.in,https://staging.vachix.in
  EXTRA_ALLOWED_ORIGINS: z.string().default(''),

  // Email / notifications
  RESEND_API_KEY:    z.string().default(''),
  EMAIL_FROM:        z.string().default(''),
  // Comma-separated list of recipients for internal B2B lead alerts.
  LEAD_NOTIFY_EMAIL: z.string().default(''),

  // Redis
  REDIS_URL: z.string().default(''),

  // Observability
  SENTRY_DSN:         z.string().default(''),
  SENTRY_TRACES_RATE: z.coerce.number().min(0).max(1).default(0.1),
  METRICS_TOKEN:      z.string().default(''),

  // AI rate-limiting / concurrency
  // All coerced to their native type — no more parseInt() at call sites.
  SYSTEM_MAX_RPM:          z.coerce.number().int().positive().default(60),
  // Treated as true unless the string is exactly "false".
  SYSTEM_SHED_ENABLED:     z.string().transform(v => v !== 'false').default('true'),
  MAX_CONCURRENT_AI_CALLS: z.coerce.number().int().positive().default(10),
  AI_QUEUE_TIMEOUT_MS:     z.coerce.number().int().positive().default(30_000),
  AI_BURST_LIMIT:          z.coerce.number().int().positive().default(3),
  AI_BURST_WINDOW_MS:      z.coerce.number().int().positive().default(10_000),
  // Total estimated prompt tokens (system + conversation history) the
  // sliding-window trimmer in core/utils/tokens.ts will allow through to
  // the provider, after reserving room for the response (max_tokens).
  // Keeps a 100-message / 32K-char-per-message conversation from blowing
  // past the model's usable context window.
  AI_CONTEXT_TOKEN_BUDGET: z.coerce.number().int().positive().default(8_000),
  // Optional — per-type TTLs apply when absent.
  AI_CACHE_TTL_SECONDS:    z.coerce.number().int().nonnegative().optional(),
  // TTL for the per-session assembled system-prompt cache
  // (memory + weak-areas + adaptive + onboarding), keyed by session_id.
  // Sessions rarely run longer than ~20-30 min; default gives headroom
  // without keeping stale personalisation context around indefinitely.
  AI_PROMPT_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  CB_FAILURE_THRESHOLD:    z.coerce.number().int().positive().default(5),
  CB_RESET_TIMEOUT_MS:     z.coerce.number().int().positive().default(60_000),

  // Web Push / VAPID (migration 015 — weekly progress cards)
  // Generate a keypair with: npx web-push generate-vapid-keys
  // VAPID_CONTACT_EMAIL is the mailto: address sent to push services.
  // Optional — if unset, web push notifications are silently skipped.
  VAPID_PUBLIC_KEY:    z.string().default(''),
  VAPID_PRIVATE_KEY:   z.string().default(''),
  VAPID_CONTACT_EMAIL: z.string().default(''),

  // Firebase Cloud Messaging — native push for iOS/Android.
  // Set to the full JSON of a Firebase service account credential
  // (download from Firebase console → Project settings → Service accounts).
  // Optional — if unset, FCM sends are silently skipped (tokens are still
  // stored; the send path just won't fire until this is populated).
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().default(''),

  // Feature flags
  // HUMANIZE_COACH: enables Aria's coach-style rewrite + per-turn tone detection.
  // Default true — it's purely additive (no schema changes, no new DB reads).
  // Set to "false" in Railway env to roll back instantly if session_completion_rate drops.
  HUMANIZE_COACH: z.string().transform(v => v !== 'false').default('true'),

  // Voice usage ledger (migration 011)
  // Per-plan monthly voice caps (seconds). -1 = unlimited.
  // free:    no voice (gated by requireVoiceTier in voice.routes.ts)
  // starter: 1200 s = 20 min
  // pro:     3600 s = 60 min
  // elite:   7200 s = 120 min
  // Sarvam voice balance (Aria questions + Elara corrections share one pool).
  // Both voices debit the same pool — one debit type, one reset, one balance shown.
  VOICE_CAP_STARTER:       z.coerce.number().int().default(1200),  // 20 min
  VOICE_CAP_PRO:           z.coerce.number().int().default(3600),  // 60 min
  VOICE_CAP_ELITE:         z.coerce.number().int().default(7200),  // 120 min

  // Avatar (Simli WebRTC) — separate minute pool, billed per-minute of active
  // connection (fundamentally different from TTS characters). -1 = unlimited.
  // Starter: 10 min taste (2-3 sessions); Pro: 40 min; Elite: 80 min.
  // Resets 1st of month IST alongside voice. No streak bonus for avatar.
  AVATAR_CAP_STARTER:      z.coerce.number().int().default(1200),  // 20 min
  AVATAR_CAP_PRO:          z.coerce.number().int().default(3600),  // 60 min
  AVATAR_CAP_ELITE:        z.coerce.number().int().default(7200),  // 120 min
  // Simli WebRTC — API key is server-side only (never sent to browser).
  // The backend calls generateSimliSessionToken() and vends the short-lived
  // session_token to the client via /api/voice/avatar/start.
  // SIMLI_FACE_ID: the Elara face to use (get from Simli dashboard).
  SIMLI_API_KEY:  z.string().min(1).optional(),
  SIMLI_FACE_ID:  z.string().min(1).optional(),
  // Hard ceiling on streak-milestone bonus voice seconds a user can
  // accumulate. Enforced via LEAST() inside the RPC (same as referral cap).
  MAX_BONUS_VOICE_SECONDS: z.coerce.number().int().positive().default(3600),
  // Bonus seconds awarded per streak milestone (7 / 14 / 21 / etc.)
  STREAK_VOICE_BONUS_SECS: z.coerce.number().int().nonnegative().default(300),
  // Sarvam circuit breaker — prevents hammering a downed Sarvam with full
  // traffic. After FAILURE_THRESHOLD consecutive failures the breaker opens
  // (routes straight to ElevenLabs). After COOLDOWN_MS it half-opens and
  // probes Sarvam with one request; success closes the breaker immediately.
  SARVAM_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(3),
  SARVAM_BREAKER_COOLDOWN_MS:       z.coerce.number().int().positive().default(15_000),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production' && !data.SUPABASE_ANON_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SUPABASE_ANON_KEY'],
      message:
        "SUPABASE_ANON_KEY is required in production. Set it to your Supabase project's " +
        'anon/public key — falling back to the service-role key would bypass Row Level Security.',
    });
  }

  // REDIS_URL must be set in production. Without it the refresh-token grace
  // cache silently degrades to an in-process Map, which breaks under horizontal
  // scale (false-positive token-theft logouts) and hides misconfigurations.
  if (data.NODE_ENV === 'production' && !data.REDIS_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['REDIS_URL'],
      message:
        'REDIS_URL is required in production. Without it the refresh-token grace cache ' +
        'falls back to an in-process Map, which is broken under multi-instance deployments.',
    });
  }
});

// Parse & fail fast

const _result = EnvSchema.safeParse(process.env);

if (!_result.success) {
  const issues = _result.error.issues
    .map(i => `  • ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n❌  Environment validation failed:\n${issues}\n`);
  process.exit(1);
}

const _parsed = _result.data;

// Derived keys
// production builds can no longer reach this fallback — superRefine
// above fails fast at startup if SUPABASE_ANON_KEY is missing in prod.
// In dev/test, it's still convenient to omit it and fall back to the
// service-role key, with a loud one-time warning so the gap stays visible.
const _resolvedAnonKey: string = (() => {
  if (!_parsed.SUPABASE_ANON_KEY) {
    // eslint-disable-next-line no-console
    console.warn(
      '⚠️  SUPABASE_ANON_KEY is not set — falling back to SUPABASE_SERVICE_KEY. ' +
      "This bypasses Row Level Security. Set SUPABASE_ANON_KEY to your project's anon/public key. " +
      '(Allowed in dev/test only — production fails to start without it.)'
    );
    return _parsed.SUPABASE_SERVICE_KEY;
  }
  return _parsed.SUPABASE_ANON_KEY;
})();

// Exports

export const env = {
  ..._parsed,
  // Override the optional field with its resolved (always-string) value.
  SUPABASE_ANON_KEY:         _resolvedAnonKey,
  // Alias used by any callers that reference the Supabase service-role key name.
  SUPABASE_SERVICE_ROLE_KEY: _parsed.SUPABASE_SERVICE_KEY,
};

/** Inferred type of the validated environment — import where needed for typing. */
export type Env = typeof env;

export const IS_PROD = env.NODE_ENV === 'production';

export type PlanType = 'free' | 'starter' | 'pro' | 'elite';

/**
 * ai_calls is no longer a monthly counter. The monthly gate is sessions only
 * (SESSION_CAP_* below). The per-session depth guard (MAX_QUESTIONS_PER_SESSION)
 * is the only AI-call limit — no user ever hits it naturally.
 *
 * Kept as a record so callers that reference PLAN_LIMITS compile without
 * changes; the value is -1 (unlimited) for every tier.
 */
export const PLAN_LIMITS: Record<PlanType, { ai_calls: number }> = {
  free:    { ai_calls: -1 },
  starter: { ai_calls: -1 },
  pro:     { ai_calls: -1 },
  elite:   { ai_calls: -1 },
};

/**
 * Hard ceiling on AI exchanges within a single session.
 * Protects against runaway loops — no legitimate interview reaches this.
 */
export const MAX_QUESTIONS_PER_SESSION = 15;

/**
 * Monthly base session caps.
 * Streak bonus sessions are stored in usage.monthly_session_bonus and added
 * on top at enforcement time.
 *
 *   Free:    5  base + up to 2 streak bonus  = 7   max
 *   Starter: 30 base + up to 10 streak bonus = 40  max
 *   Pro:     60 base + up to 15 streak bonus = 75  max
 *   Elite:   90 base + up to 20 streak bonus = 110 max
 */
export const SESSION_CAP_FREE    = 5;
export const SESSION_CAP_STARTER = 30;
export const SESSION_CAP_PRO     = 60;
export const SESSION_CAP_ELITE   = 90;

/**
 * Ceiling on streak bonus sessions that can accumulate per plan.
 * Enforced via LEAST() in the addBonusSessions RPC.
 */
export const SESSION_BONUS_CAP_FREE    = 2;
export const SESSION_BONUS_CAP_STARTER = 10;
export const SESSION_BONUS_CAP_PRO     = 15;
export const SESSION_BONUS_CAP_ELITE   = 20;

/**
 * Bonus sessions granted to the REFERRER per successful referral
 * (triggered when the referred user completes their first session).
 * Amount is plan-keyed on the referrer's current plan at reward time.
 * Bonus is credited to usage.monthly_session_bonus and does NOT roll over.
 */
export const REFERRAL_BONUS_SESSIONS: Record<PlanType, number> = {
  // Free-plan referrers earn +1 bonus session when their referred friend
  // completes a first session.  The spec covers Starter/Pro/Elite explicitly;
  // free is a deliberate defensive default so the map stays total over
  // PlanType and the reward path never has to handle a missing key.
  // If the product decision changes (free referrers earn nothing), set this
  // to 0 — the addBonusSessions RPC is a no-op for a 0-delta.
  free:    1,
  starter: 2,
  pro:     5,
  elite:   10,
};

/**
 * In paise (INR × 100).
 * 2026-06 pricing:
 *   Starter ₹249 · Pro ₹599 · Elite ₹999
 */
export const PLAN_PRICES: Record<'starter' | 'pro' | 'elite', number> = {
  starter: 24900,   // ₹249
  pro:     59900,   // ₹599
  elite:   99900,   // ₹999
};
