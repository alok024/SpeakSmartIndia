/**
 * Environment configuration — validated at startup.
 * Required vars cause process.exit(1) if missing.
 * Optional vars have safe defaults.
 */

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'GROQ_API_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
] as const;

for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env variable: ${key}`);
    process.exit(1);
  }
}

export const env = {
  NODE_ENV:     process.env.NODE_ENV     || 'production',
  PORT:         process.env.PORT         || '3000',

  SUPABASE_URL:         process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY!,

  JWT_SECRET:          process.env.JWT_SECRET!,
  JWT_REFRESH_SECRET:  process.env.JWT_REFRESH_SECRET!,

  GROQ_API_KEY:   process.env.GROQ_API_KEY!,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',

  RAZORPAY_KEY_ID:         process.env.RAZORPAY_KEY_ID!,
  RAZORPAY_KEY_SECRET:     process.env.RAZORPAY_KEY_SECRET!,
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET!,

  FRONTEND_URL: process.env.FRONTEND_URL || 'https://speaksmart.in',

  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  EMAIL_FROM:     process.env.EMAIL_FROM     || '',

  REDIS_URL: process.env.REDIS_URL || '',

  SENTRY_DSN:         process.env.SENTRY_DSN         || '',
  SENTRY_TRACES_RATE: process.env.SENTRY_TRACES_RATE || '0.1',
  METRICS_TOKEN:      process.env.METRICS_TOKEN       || '',

  SYSTEM_MAX_RPM:          process.env.SYSTEM_MAX_RPM          || '60',
  SYSTEM_SHED_ENABLED:     process.env.SYSTEM_SHED_ENABLED     || 'true',
  MAX_CONCURRENT_AI_CALLS: process.env.MAX_CONCURRENT_AI_CALLS || '10',
  AI_QUEUE_TIMEOUT_MS:     process.env.AI_QUEUE_TIMEOUT_MS     || '30000',
  AI_BURST_LIMIT:          process.env.AI_BURST_LIMIT          || '3',
  AI_BURST_WINDOW_MS:      process.env.AI_BURST_WINDOW_MS      || '10000',
  AI_CACHE_TTL_SECONDS:    process.env.AI_CACHE_TTL_SECONDS    || '',
  CB_FAILURE_THRESHOLD:    process.env.CB_FAILURE_THRESHOLD    || '5',
  CB_RESET_TIMEOUT_MS:     process.env.CB_RESET_TIMEOUT_MS     || '60000',
  REFERRAL_BONUS_CALLS:    process.env.REFERRAL_BONUS_CALLS    || '10',
} as const;

export const IS_PROD = env.NODE_ENV === 'production';

export type PlanType = 'free' | 'pro' | 'elite';

/** -1 = unlimited */
export const PLAN_LIMITS: Record<PlanType, { ai_calls: number }> = {
  free:  { ai_calls: 30 },
  pro:   { ai_calls: -1 },
  elite: { ai_calls: -1 },
};

/** In paise (INR × 100) */
export const PLAN_PRICES: Record<'pro' | 'elite', number> = {
  pro:   29900,  // ₹299
  elite: 59900,  // ₹599
};
