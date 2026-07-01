/**
 * Auth route integration tests — POST /api/login
 *
 * express-rate-limit is mocked to a passthrough for all tests except the
 * dedicated rate-limit test, which restores the real implementation and uses
 * a unique IP to isolate its counter from every other test in the suite.
 */

import request from 'supertest';
import bcrypt  from 'bcryptjs';
import jwt     from 'jsonwebtoken';

// ── Infrastructure mocks (must precede any app import) ───────────────────────

const silentChild = () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
});

jest.mock('../../src/infra/logger', () => ({
  logger:             { child: silentChild, ...silentChild() },
  authLogger:         silentChild(),
  paymentLogger:      silentChild(),
  aiLogger:           { child: silentChild, ...silentChild() },
  subscriptionLogger: silentChild(),
}));

jest.mock('../../src/infra/observability', () => ({
  initSentry:       jest.fn().mockResolvedValue(undefined),
  captureException: jest.fn(),
  getMetrics:       jest.fn().mockReturnValue({}),
}));

jest.mock('../../src/infra/load-monitor', () => ({
  startLoadMonitor:   jest.fn(),
  getSystemLoadStats: jest.fn().mockReturnValue({}),
}));

jest.mock('../../src/infra/ai-limiter', () => ({
  getAILimiterStats: jest.fn().mockReturnValue({}),
}));

jest.mock('../../src/infra/circuit-breaker', () => ({
  groqBreaker:    { getState: jest.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }) },
  openaiBreaker:  { getState: jest.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }) },
  CircuitBreaker: jest.fn(),
}));

jest.mock('../../src/infra/queue/dispatcher', () => ({
  scheduleSubscriptionExpiry:  jest.fn().mockResolvedValue(undefined),
  scheduleSessionExpiry:       jest.fn().mockResolvedValue(undefined),
  scheduleBlacklistCleanup:    jest.fn(),
  scheduleComparisonCleanup:   jest.fn(),
  scheduleWeeklyProgressCards: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/modules/analytics/reports/weekly-card.service', () => ({
  initVapid: jest.fn(),
}));

jest.mock('../../src/modules/analytics/events/events.service', () => ({
  registerShutdownFlush: jest.fn(),
  trackEvent:            jest.fn(),
}));

jest.mock('../../src/modules/growth/referral.service', () => ({
  getOrCreateReferralCode: jest.fn(),
}));

// ── Rate-limit mock ───────────────────────────────────────────────────────────
// express-rate-limit's MemoryStore is keyed by req.ip. supertest bypasses the
// real network stack so req.ip is always 127.0.0.1 regardless of any
// X-Forwarded-For header — meaning hit counts bleed across every test in the
// suite and trip the loginLimiter (max 10) before the later tests run.
//
// Solution: mock rateLimit to a passthrough for the whole module. The one test
// that verifies rate-limiting behaviour uses jest.isolateModules() to load a
// fresh, unmocked app instance so the real limiter runs in isolation.

jest.mock('express-rate-limit', () => {
  // Return a passthrough middleware factory so no request is ever rate-limited
  // during normal tests. Named exports (MemoryStore etc.) are passed through.
  // Note: jest.requireActual MUST be called inside the factory (not at
  // module scope) because jest.mock() is hoisted before any variable
  // declarations, so any reference to a variable defined with const/let at
  // module scope is a TDZ error inside a factory that runs at hoist time.
  const actual = jest.requireActual<typeof import('express-rate-limit')>('express-rate-limit');
  const passthrough = () => (_req: unknown, _res: unknown, next: () => void) => next();
  // Copy named exports (MemoryStore, rateLimit, etc.) so any named import
  // from the module still resolves to the real implementation.
  return {
    ...actual,
    default:    passthrough,
    rateLimit:  passthrough,
    __esModule: true,
  };
});

// ── DB mock ───────────────────────────────────────────────────────────────────

jest.mock('../../src/core/database/client', () => ({
  db: {
    getUserByEmail:     jest.fn(),
    getUserById:        jest.fn(),
    createUser:         jest.fn(),
    getUsage:           jest.fn(),
    isTokenBlacklisted: jest.fn().mockResolvedValue(false),
    createUsage:        jest.fn(),
  },
}));

// ── App + db ──────────────────────────────────────────────────────────────────

import app from '../../src/app';
import { db } from '../../src/core/database/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buildFakeUser(overrides: Partial<{
  id: string;
  email: string;
  password: string;
  plan: string;
  email_verified: boolean;
}> = {}) {
  const {
    id             = 'user-uuid-login-test',
    email          = 'test@vachix.in',
    password       = 'ValidPass123',
    plan           = 'free',
    email_verified = true,
  } = overrides;

  const password_hash = await bcrypt.hash(password, 1);

  return {
    id, email, password_hash, plan,
    name:           'Test User',
    email_verified,
    referral_code:  null,
    referred_by:    null,
    referral_bonus: 0,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.getUsage as jest.Mock).mockResolvedValue({ call_count: 0 });
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app).post('/api/login').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app).post('/api/login').send({ password: 'somepassword' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app).post('/api/login').send({ email: 'user@test.com' });
    expect(res.status).toBe(400);
  });

  it('returns 400 with an invalid email format', async () => {
    const res = await request(app).post('/api/login').send({ email: 'not-an-email', password: 'somepassword' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is an empty string', async () => {
    const res = await request(app).post('/api/login').send({ email: 'user@test.com', password: '' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when user does not exist', async () => {
    (db.getUserByEmail as jest.Mock).mockResolvedValue(null);
    const res = await request(app).post('/api/login').send({ email: 'ghost@test.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when password is wrong', async () => {
    const user = await buildFakeUser({ password: 'CorrectHorse99' });
    (db.getUserByEmail as jest.Mock).mockResolvedValue(user);
    const res = await request(app).post('/api/login').send({ email: user.email, password: 'WrongPassword!' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when email is not verified', async () => {
    const user = await buildFakeUser({ email_verified: false });
    (db.getUserByEmail as jest.Mock).mockResolvedValue(user);
    const res = await request(app).post('/api/login').send({ email: user.email, password: 'ValidPass123' });
    expect(res.status).toBe(403);
  });

  it('returns 200 with valid credentials for a verified user', async () => {
    const user = await buildFakeUser();
    (db.getUserByEmail as jest.Mock).mockResolvedValue(user);
    const res = await request(app).post('/api/login').send({ email: user.email, password: 'ValidPass123' });
    expect(res.status).toBe(200);
  });

  it('does not leak which field was wrong (same 401 for bad email vs bad password)', async () => {
    const user = await buildFakeUser();
    (db.getUserByEmail as jest.Mock).mockResolvedValue(user);

    const wrongPass = await request(app).post('/api/login').send({ email: user.email, password: 'wrong' });

    (db.getUserByEmail as jest.Mock).mockResolvedValue(null);

    const noUser = await request(app).post('/api/login').send({ email: 'nobody@test.com', password: 'wrong' });

    expect(wrongPass.status).toBe(401);
    expect(noUser.status).toBe(401);
  });

  it('normalises email to lowercase before lookup', async () => {
    const user = await buildFakeUser({ email: 'user@test.com' });
    (db.getUserByEmail as jest.Mock).mockResolvedValue(user);

    await request(app).post('/api/login').send({ email: 'USER@TEST.COM', password: 'ValidPass123' });

    expect(db.getUserByEmail).toHaveBeenCalledWith('user@test.com');
  });

  // ── Rate limiting ───────────────────────────────────────────────────────────
  // Loaded in a fresh isolated module scope so the real (unmocked) rateLimit
  // runs and the MemoryStore starts at zero — no bleed from tests above.

  it('rate-limits after 10 attempts per minute from the same IP', async () => {
    await jest.isolateModulesAsync(async () => {
      // Restore the real express-rate-limit inside this isolated scope.
      // jest.mock() calls are file-scoped and apply to isolateModulesAsync
      // registries too — without explicitly unmocking here, the passthrough
      // stub above would still run and the 429 would never fire.
      jest.unmock('express-rate-limit');

      // Re-mock everything except express-rate-limit so the real limiter runs
      jest.mock('../../src/infra/logger', () => ({
        logger:             { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        authLogger:         { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        paymentLogger:      { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        aiLogger:           { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        subscriptionLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      }));
      jest.mock('../../src/infra/observability', () => ({ initSentry: jest.fn().mockResolvedValue(undefined), captureException: jest.fn(), getMetrics: jest.fn().mockReturnValue({}) }));
      jest.mock('../../src/infra/load-monitor', () => ({ startLoadMonitor: jest.fn(), getSystemLoadStats: jest.fn().mockReturnValue({}) }));
      jest.mock('../../src/infra/ai-limiter', () => ({ getAILimiterStats: jest.fn().mockReturnValue({}) }));
      jest.mock('../../src/infra/circuit-breaker', () => ({ groqBreaker: { getState: jest.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }) }, openaiBreaker: { getState: jest.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }) }, CircuitBreaker: jest.fn() }));
      jest.mock('../../src/infra/queue/dispatcher', () => ({ scheduleSubscriptionExpiry: jest.fn().mockResolvedValue(undefined), scheduleSessionExpiry: jest.fn().mockResolvedValue(undefined), scheduleBlacklistCleanup: jest.fn(), scheduleComparisonCleanup: jest.fn(), scheduleWeeklyProgressCards: jest.fn().mockResolvedValue(undefined) }));
      jest.mock('../../src/modules/analytics/reports/weekly-card.service', () => ({ initVapid: jest.fn() }));
      jest.mock('../../src/modules/analytics/events/events.service', () => ({ registerShutdownFlush: jest.fn(), trackEvent: jest.fn() }));
      jest.mock('../../src/modules/growth/referral.service', () => ({ getOrCreateReferralCode: jest.fn() }));
      jest.mock('../../src/core/database/client', () => ({ db: { getUserByEmail: jest.fn().mockResolvedValue(null), getUserById: jest.fn(), createUser: jest.fn(), getUsage: jest.fn().mockResolvedValue({ call_count: 0 }), isTokenBlacklisted: jest.fn().mockResolvedValue(false), createUsage: jest.fn() } }));

      const { default: isolatedApp } = await import('../../src/app');

      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await request(isolatedApp)
          .post('/api/login')
          .set('X-Forwarded-For', '10.0.0.99')
          .send({ email: 'test@test.com', password: 'x' });
        statuses.push(res.status);
      }

      expect(statuses[10]).toBe(429);
    });
  });
});

describe('POST /api/login — mobile client token body', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.getUsage as jest.Mock).mockResolvedValue({ call_count: 0 });
  });

  it('omits tokens from the body by default (browser/cookie flow)', async () => {
    const user = await buildFakeUser();
    (db.getUserByEmail as jest.Mock).mockResolvedValue(user);

    const res = await request(app).post('/api/login').send({ email: user.email, password: 'ValidPass123' });

    expect(res.status).toBe(200);
    expect(res.body.data.tokens).toBeUndefined();
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('includes access_token + refresh_token in the body when X-Vachix-Client: mobile is set', async () => {
    const user = await buildFakeUser();
    (db.getUserByEmail as jest.Mock).mockResolvedValue(user);

    const res = await request(app)
      .post('/api/login')
      .set('X-Vachix-Client', 'mobile')
      .send({ email: user.email, password: 'ValidPass123' });

    expect(res.status).toBe(200);
    expect(typeof res.body.data.tokens.access_token).toBe('string');
    expect(typeof res.body.data.tokens.refresh_token).toBe('string');
    expect(res.body.data.tokens.token_type).toBe('Bearer');
    expect(res.body.data.tokens.expires_in).toBe(30 * 60);
    // Cookies are still set even for mobile — harmless if the client
    // ignores them, and keeps the response shape uniform.
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('the returned access_token is a JWT valid against the same secret authMiddleware checks', async () => {
    const user = await buildFakeUser();
    (db.getUserByEmail as jest.Mock).mockResolvedValue(user);

    const loginRes = await request(app)
      .post('/api/login')
      .set('X-Vachix-Client', 'mobile')
      .send({ email: user.email, password: 'ValidPass123' });

    const { access_token } = loginRes.body.data.tokens;
    const decoded = jwt.verify(access_token, process.env.JWT_SECRET as string) as { id: string; email: string };

    expect(decoded.id).toBe(user.id);
    expect(decoded.email).toBe(user.email);
  });
});
