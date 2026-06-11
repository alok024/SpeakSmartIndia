import express, { Request, Response } from 'express';
import cors       from 'cors';
import helmet     from 'helmet';
import rateLimit  from 'express-rate-limit';
import { env, IS_PROD }              from './core/config/env';
import { errorHandler }              from './core/middleware';
import { logger }                    from './infra/logger';
import { scheduleSubscriptionExpiry } from './infra/queue/dispatcher';
import { initSentry, captureException, getMetrics } from './infra/observability';
import { startLoadMonitor, getSystemLoadStats }      from './infra/load-monitor';
import { getAILimiterStats }                         from './infra/ai-limiter';
import { groqBreaker, openaiBreaker }                from './infra/circuit-breaker';

// ── Route modules ─────────────────────────────────────────────────
import authRoutes    from './modules/auth/auth.routes';
import paymentRoutes from './modules/payment/payment.routes';
import userRoutes    from './modules/user/user.routes';
import aiRoutes      from './modules/ai/ai.routes';
import sessionRoutes from './modules/analytics/sessions.routes';
import reportRoutes  from './modules/reports/reports.routes';

// ── Boot: Sentry + load monitor ───────────────────────────────────
initSentry().catch(() => {});   // fire-and-forget; never blocks startup
startLoadMonitor();              // heartbeat log every 5 min

const app = express();
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: IS_PROD ? undefined : false,
}));

// ── CORS ──────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://speaksmart.in',
  'https://www.speaksmart.in',
  'https://speaksmartindia.vercel.app',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:5500',
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (!IS_PROD) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Webhook — raw body BEFORE express.json() ─────────────────────
app.post(
  '/api/payment/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    import('./modules/payment/payment.controller')
      .then(m => m.webhook(req, res))
      .catch(next);
  }
);

// ── Body parsing ──────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── Global rate limit ─────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 60_000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
}));

// ── Request logging ───────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`, { ip: req.ip, origin: req.headers.origin });
  next();
});

// ── Health & status endpoints ─────────────────────────────────────

app.get('/', (_req: Request, res: Response) => {
  res.json({
    status:  'SpeakSmart API running ✅',
    version: '5.0.0',
    env:     env.NODE_ENV,
    queue:   env.REDIS_URL ? 'BullMQ (Redis)' : 'inline (no Redis)',
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

/**
 * GET /health/metrics  — internal ops dashboard (never expose publicly)
 *
 * Returns:
 *   - AI call counters + cache/fallback/failure rates
 *   - System load (RPM, concurrency slots)
 *   - Circuit breaker states per provider
 *
 * Protect this in production with a METRICS_TOKEN header check or
 * restrict to internal network only.
 */
app.get('/health/metrics', (req: Request, res: Response) => {
  const token = process.env.METRICS_TOKEN;
  if (token && req.headers['x-metrics-token'] !== token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.json({
    metrics:        getMetrics(),
    system_load:    getSystemLoadStats(),
    ai_concurrency: getAILimiterStats(),
    circuit_breakers: {
      groq:   groqBreaker.getState(),
      openai: openaiBreaker.getState(),
    },
  });
});

// ── Routes ────────────────────────────────────────────────────────
app.use('/api',          userRoutes);
app.use('/api',          authRoutes);
app.use('/api/payment',  paymentRoutes);
app.use('/api/ai',       aiRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/report',   reportRoutes);

// ── 404 ───────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────
app.use((err: Error, req: Request, res: Response, next: express.NextFunction) => {
  captureException(err, {
    userId: (req as Request & { user?: { id: string; plan: string } }).user?.id,
    plan:   (req as Request & { user?: { id: string; plan: string } }).user?.plan,
  });
  errorHandler(err, req, res, next);
});

// ── Start ─────────────────────────────────────────────────────────
const PORT = parseInt(env.PORT, 10);

app.listen(PORT, () => {
  logger.info('🚀 SpeakSmart API started', {
    port: PORT, env: env.NODE_ENV, version: '5.0.0',
    queue: env.REDIS_URL ? 'BullMQ (Redis)' : 'inline (no Redis)',
  });

  scheduleSubscriptionExpiry().catch(err =>
    logger.error('Failed to schedule subscription expiry', { error: err })
  );
});

export default app;
