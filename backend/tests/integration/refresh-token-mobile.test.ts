/**
 * POST /api/refresh-token — mobile (no cookie jar) fallback
 *
 * Mobile clients don't carry a cookie jar, so the refresh token they stored
 * from login/register has to be replayable via the request body instead of
 * the REFRESH_COOKIE. This file only exercises that controller-level
 * fallback; refreshAccessToken()'s own rotation/grace-window/reuse-detection
 * logic is already covered in tests/unit/auth.service.test.ts.
 */

import request from 'supertest';
import jwt     from 'jsonwebtoken';

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

jest.mock('express-rate-limit', () => {
  const actual = jest.requireActual<typeof import('express-rate-limit')>('express-rate-limit');
  const passthrough = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return { ...actual, default: passthrough, rateLimit: passthrough, __esModule: true };
});

const mockDb = {
  isTokenBlacklisted: jest.fn().mockResolvedValue(false),
  blacklistToken:     jest.fn().mockResolvedValue(undefined),
  getUserById:        jest.fn(),
};

jest.mock('../../src/core/database/client', () => ({ db: mockDb }));

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
};

jest.mock('../../src/infra/queue/redis', () => ({
  getRedis: jest.fn(() => mockRedis),
}));

import app from '../../src/app';

const TEST_USER = {
  id:             'user-refresh-mobile',
  email:          'mobile@vachix.in',
  plan:           'starter',
  name:           'Mobile User',
  email_verified: true,
};

function mintRefreshToken(): string {
  return jwt.sign(
    { id: TEST_USER.id, jti: 'refresh-jti-1', type: 'refresh' },
    process.env.JWT_REFRESH_SECRET as string,
    { expiresIn: '30d' },
  );
}

describe('POST /api/refresh-token — mobile fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.isTokenBlacklisted.mockResolvedValue(false);
    mockDb.blacklistToken.mockResolvedValue(undefined);
    mockDb.getUserById.mockResolvedValue(TEST_USER);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
  });

  it('returns 401 when neither a cookie nor a body token is present', async () => {
    const res = await request(app).post('/api/refresh-token').send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('no_refresh_token');
  });

  it('refreshes using only a body refresh_token (no cookie) — the mobile path', async () => {
    const refreshToken = mintRefreshToken();
    const res = await request(app)
      .post('/api/refresh-token')
      .send({ refresh_token: refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.refreshed).toBe(true);
    expect(mockDb.getUserById).toHaveBeenCalledWith(TEST_USER.id);
  });

  it('also returns the new tokens in the body when X-Vachix-Client: mobile is set', async () => {
    const refreshToken = mintRefreshToken();
    const res = await request(app)
      .post('/api/refresh-token')
      .set('X-Vachix-Client', 'mobile')
      .send({ refresh_token: refreshToken });

    expect(res.status).toBe(200);
    expect(typeof res.body.data.tokens.access_token).toBe('string');
    expect(typeof res.body.data.tokens.refresh_token).toBe('string');
  });
});
