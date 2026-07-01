import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import cors       from 'cors';
import helmet     from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit  from 'express-rate-limit';
import { env, IS_PROD }              from './core/config/env';
import { errorHandler }              from './core/middleware';
import { unauthorized, notFound }     from './core/utils/response';
import { logger }                    from './infra/logger';
import { scheduleSubscriptionExpiry, scheduleSessionExpiry, scheduleBlacklistCleanup, scheduleComparisonCleanup, scheduleWeeklyProgressCards } from './infra/queue/dispatcher';
import { initSentry, captureException, getMetrics } from './infra/observability';
import { requestContextStore }                       from './infra/request-context';
import { startLoadMonitor, getSystemLoadStats }      from './infra/load-monitor';
import { getAILimiterStats }                         from './infra/ai-limiter';
import { groqBreaker, openaiBreaker }                from './infra/circuit-breaker';
import { getQueueDepth }                             from './infra/queue/queues';
import { getRedis }                                  from './infra/queue/redis';
import { getVoiceLatencyStats }                      from './infra/voice-latency';

// Route modules
import authRoutes    from './modules/auth/auth.routes';
import paymentRoutes from './modules/payment/payment.routes';
import userRoutes         from './modules/user/profile/profile.routes';
import resultsBoardRoutes from './modules/user/results-board/results-board.routes';
import aiRoutes      from './modules/ai/chat/chat.routes';
import sessionRoutes from './modules/analytics/sessions/sessions.routes';
import reportRoutes  from './modules/reports/reports.routes';
import certificateRoutes from './modules/certificates/certificates.routes';
import comparisonRoutes  from './modules/comparison/comparison.routes';
import adminRoutes   from './modules/admin/admin.routes';
import leadsRoutes   from './modules/leads/leads.routes';
import voiceRoutes   from './modules/voice/voice.routes';
import eventsRoutes  from './modules/analytics/events/events.routes';
import { pushRouter }    from './modules/push/push.routes';
import interviewRoutes   from './modules/interview/interview.routes';
import speechRoutes      from './modules/speech/speech.routes';
import prepPathsRoutes   from './modules/prep-paths/prep-paths.routes';
import elaraRoutes       from './modules/elara/elara.routes';
import leaderboardRoutes from './modules/analytics/leaderboard/leaderboard.routes';
import { registerShutdownFlush } from './modules/analytics/events/events.service';
import { initVapid } from './modules/analytics/reports/weekly-card.service';
import { attachSttWebSocket } from './modules/voice/stt-ws.handler';

// Extend Express Request with requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

// Boot: Sentry + load monitor
initSentry().catch(() => {});   // fire-and-forget; never blocks startup
startLoadMonitor();              // heartbeat log every 5 min

const app = express();
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: IS_PROD ? undefined : false,
}));

// CORS
const PROD_ORIGINS = [
  'https://vachix.in',
  'https://www.vachix.in',
  'https://vachixindia.pages.dev',
  'https://vachixindia.vercel.app',
  'https://vachix.pages.dev',
];

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:5500',
];

// Vercel preview deployments use dynamic subdomain URLs
// (e.g. vachixindia-git-fix-branch-xyz.vercel.app) that can't be
// hardcoded here. EXTRA_ALLOWED_ORIGINS (comma-separated) lets you add
// preview/staging origins via a Railway env var without a code deploy.
// Never set this to a wildcard or an attacker-controlled domain — each
// entry must be an exact origin including scheme (https://...).
const EXTRA_ORIGINS: string[] = env.EXTRA_ALLOWED_ORIGINS
  ? env.EXTRA_ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : [];

const ALLOWED_ORIGINS = IS_PROD
  ? [...PROD_ORIGINS, ...EXTRA_ORIGINS]
  : [...PROD_ORIGINS, ...EXTRA_ORIGINS, ...DEV_ORIGINS];

app.use(cors({
  origin: (origin, cb) => {
    // Always validate against the allowlist regardless of environment.
    // Previously `if (!IS_PROD) return cb(null, true)` allowed every origin on
    // staging/preview deployments, making credentialed cross-origin requests
    // possible from any attacker-controlled site. Same-origin and null-origin
    // (curl / server-to-server) are still allowed via the !origin check below.
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// Webhook — raw body BEFORE express.json()
app.post(
  '/api/payment/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    import('./modules/payment/payment.controller')
      .then(m => m.webhook(req, res))
      .catch(next);
  }
);

// Body parsing
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// Global rate limit
app.use(rateLimit({
  windowMs: 60_000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } },
}));

// Request ID + structured request logging
// Every request gets a unique requestId attached to req and to the
// response header (X-Request-Id). The AsyncLocalStorage store is seeded
// here so every log call downstream (services, ledgers, queue dispatchers)
// automatically includes requestId — no manual threading needed.
app.use((req: Request, res: Response, next: NextFunction) => {
  req.requestId = (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);

  const startMs = Date.now();

  // BUGFIX: the X-Response-Time header used to be set inside the 'finish'
  // listener below. 'finish' fires *after* the response (headers + body)
  // has already been flushed to the socket, so res.setHeader() there
  // throws ERR_HTTP_HEADERS_SENT ("Cannot set headers after they are sent
  // to the client") — silently swallowed by Express's default error
  // listener in most requests, but surfaced as a hard failure whenever
  // another piece of middleware (e.g. express-rate-limit's `message`
  // response) also touches the response around the same tick, which is
  // exactly what tripped the rate-limit test.
  //
  // Fix: patch writeHead/_implicitHeader so the header is injected the
  // moment Node is about to flush headers — guaranteed to run before
  // headersSent flips true, regardless of whether the route calls
  // res.send()/res.json()/res.end() directly. This mirrors the approach
  // the `on-headers` package uses, without adding a new dependency.
  let responseTimeWritten = false;
  const writeResponseTimeHeader = (): void => {
    if (responseTimeWritten || res.headersSent) return;
    responseTimeWritten = true;
    res.setHeader('X-Response-Time', `${Date.now() - startMs}ms`);
  };

  const originalImplicitHeader = (res as Response & { _implicitHeader: () => void })._implicitHeader.bind(res);
  (res as Response & { _implicitHeader: () => void })._implicitHeader = () => {
    writeResponseTimeHeader();
    originalImplicitHeader();
  };

  const originalWriteHead = res.writeHead.bind(res);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).writeHead = (...args: any[]) => {
    writeResponseTimeHeader();
    return originalWriteHead(...args);
  };

  // Logging only — never set headers here, the response is already gone.
  res.on('finish', () => {
    const elapsed = Date.now() - startMs;
    logger.info('request_complete', {
      method:   req.method,
      path:     req.path,
      status:   res.statusCode,
      duration: elapsed,
    });
  });

  requestContextStore.run({ requestId: req.requestId }, () => {
    logger.info('incoming_request', {
      method:    req.method,
      path:      req.path,
      ip:        req.ip,
      origin:    req.headers.origin,
    });
    next();
  });
});

// Health & status endpoints

app.get('/', (_req: Request, res: Response) => {
  res.json({
    status:  'Vachix API running ✅',
    version: env.VERSION,
    env:     env.NODE_ENV,
    queue:   env.REDIS_URL ? 'BullMQ (Redis)' : 'inline (no Redis)',
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

/**
 * GET /health/ready — readiness probe (can this instance serve traffic?)
 *
 * Distinct from /health (liveness). Railway uses this path for deploy
 * healthchecks — a 503 here holds traffic back until the instance is ready.
 *
 * Checks:
 *   redis — checked in all environments when REDIS_URL is set (ping).
 *           In production without REDIS_URL, surfaces as 'missing' and
 *           returns 503 — B2B lead follow-up emails and BullMQ jobs will
 *           not run, which is a meaningful degradation for a prod deploy.
 *           In dev/test without REDIS_URL, reports 'disabled' and stays 200.
 *
 * No Supabase check — the SDK uses connection pooling and lazy connects;
 * a ping-style check would create a spurious cold connection on every probe.
 * Supabase errors surface immediately on first real request instead.
 */
app.get('/health/ready', async (_req: Request, res: Response) => {
  const checks: Record<string, 'ok' | 'error' | 'missing' | 'disabled'> = {};

  if (env.REDIS_URL) {
    try {
      const redis = getRedis();
      if (redis) await redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }
  } else if (IS_PROD) {
    // Production without Redis: B2B lead follow-up emails and background
    // jobs will silently not run. Surface this as a readiness failure so
    // Railway holds traffic or alerts on deploy rather than silently
    // degrading after rollout.
    checks.redis = 'missing';
  } else {
    // Dev/test: Redis is optional — inline fallbacks apply.
    checks.redis = 'disabled';
  }

  const allOk = Object.values(checks).every(v => v === 'ok' || v === 'disabled');
  res.status(allOk ? 200 : 503).json({ ready: allOk, checks });
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
app.get('/health/metrics', async (req: Request, res: Response) => {
  const token    = env.METRICS_TOKEN || undefined;
  const provided = req.headers['x-metrics-token'];

  // Constant-time comparison — avoids leaking the token via response-timing
  // differences on a per-character mismatch.
  const tokensMatch = (() => {
    if (typeof provided !== 'string' || !token) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  })();

  // In production: always require a token — fail closed if one isn't configured.
  // In development: allow access when no token is set (local debugging convenience).
  const authOk = IS_PROD
    ? tokensMatch
    : (!token || tokensMatch);

  if (!authOk) {
    unauthorized(res, 'Unauthorized', 'unauthorized');
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
    queue_depth:    await getQueueDepth(),  // null when Redis is unavailable
    voice_latency:  getVoiceLatencyStats(), // Phase 2 benchmark data: STT/TTS p50/p95/p99
  });
});

// Routes
// userRoutes mounts at '/api' for /api/me, /api/referral, /api/onboarding.
// resultsBoardRoutes mounts at '/api/user' for /api/user/job-landed, /api/user/results-board.
// Do not change userRoutes to '/api/user' without auditing profile.routes.ts for conflicts.
app.use('/api',          userRoutes);
app.use('/api/user',     resultsBoardRoutes);
app.use('/api',          authRoutes);
app.use('/api/payment',  paymentRoutes);
app.use('/api/ai',       aiRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/report',   reportRoutes);
app.use('/api/certificate', certificateRoutes);
app.use('/api/compare',     comparisonRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/leads',    leadsRoutes);
app.use('/api/voice',    voiceRoutes);
app.use('/api/events',   eventsRoutes);
app.use('/api',          pushRouter);
app.use('/api/interview',      interviewRoutes);
app.use('/api/speech-metrics', speechRoutes);
app.use('/api/prep-paths',    prepPathsRoutes);
app.use('/api/elara',         elaraRoutes);
app.use('/api/leaderboard',  leaderboardRoutes);

registerShutdownFlush();

// 404
app.use((_req: Request, res: Response) => {
  notFound(res, 'Route not found');
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: express.NextFunction) => {
  captureException(err, {
    userId:    (req as Request & { user?: { id: string; plan: string } }).user?.id,
    plan:      (req as Request & { user?: { id: string; plan: string } }).user?.plan,
    extra:     { requestId: req.requestId },
  });
  errorHandler(err, req, res, next);
});

// Start — skipped in test environment so integration tests can import
// the app without binding a port (avoids EADDRINUSE when Jest runs
// multiple test suites in the same process).
if (env.NODE_ENV !== 'test') {
  const PORT = env.PORT;

  const server = app.listen(PORT, () => {
    logger.info('🚀 Vachix API started', {
    port: PORT, env: env.NODE_ENV, version: env.VERSION,
    queue: env.REDIS_URL ? 'BullMQ (Redis)' : 'inline (no Redis)',
  });

  // Attach WebSocket STT handler to the underlying HTTP server.
  // Must run after listen() so the server is bound and can accept upgrades.
  attachSttWebSocket(server);

  // Health-check assertion: B2B lead follow-up depends on Redis
  // Without REDIS_URL, dispatchLeadFollowUp() silently skips scheduling
  // the 24h follow-up job. That's expected in dev, but in production it
  // means every new B2B lead gets zero automated follow-up — surface it
  // loudly at boot rather than only as a per-lead warn log.
  if (!env.REDIS_URL) {
    if (IS_PROD) {
      logger.error('REDIS_URL is not set — B2B lead 24h follow-up emails will NOT be scheduled in production');
    } else {
      logger.warn('REDIS_URL is not set — B2B lead 24h follow-up emails are disabled (expected in dev)');
    }
  }

  // Fail hard at boot when METRICS_TOKEN is absent in production.
  // /health/metrics exposes AI call counters, system RPM, concurrency stats,
  // and circuit-breaker states. The endpoint already returns 401 when the token
  // is unset (tokensMatch = false when !token), but requiring it at startup
  // prevents a misconfigured deploy from ever serving traffic without the
  // token being explicitly set. Set METRICS_TOKEN to a strong random value
  // in Railway env vars (e.g. openssl rand -hex 32).
  if (IS_PROD && !env.METRICS_TOKEN) {
    logger.error(
      'METRICS_TOKEN is not set — refusing to start in production. ' +
      'Set METRICS_TOKEN in Railway env vars to a strong random value.'
    );
    process.exit(1);
  }

  scheduleSubscriptionExpiry().catch(err =>
    logger.error('Failed to schedule subscription expiry', { error: err })
  );

  scheduleSessionExpiry().catch(err =>
    logger.error('Failed to schedule session expiry', { error: err })
  );

  // Nightly cleanup of expired token_blacklist rows to prevent unbounded
  // table growth and keep isTokenBlacklisted() fast under heavy auth load.
  scheduleBlacklistCleanup();
  scheduleComparisonCleanup();
  scheduleWeeklyProgressCards().catch(err =>
    logger.error('Failed to schedule weekly progress cards', { error: err })
  );
  initVapid();
});
} // end if (NODE_ENV !== 'test')

export default app;
