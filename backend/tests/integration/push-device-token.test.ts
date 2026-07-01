/**
 * POST /api/push/register-device, DELETE /api/push/unregister-device
 *
 * Storage-only endpoints unblocking the Flutter app's push registration
 * flow. Sending an actual notification to a registered device is a
 * separate, not-yet-implemented piece — see the TODO in push.service.ts.
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
  getUserById:        jest.fn(),
  upsertDeviceToken:  jest.fn().mockResolvedValue(undefined),
  deleteDeviceToken:  jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../src/core/database/client', () => ({ db: mockDb }));

import app from '../../src/app';

const TEST_USER = {
  id:             'user-device-token',
  email:          'device@vachix.in',
  plan:           'starter',
  email_verified: true,
};

function accessTokenFor(userId: string): string {
  return jwt.sign(
    { id: userId, plan: TEST_USER.plan, email_verified: true, jti: 'jti-device', iat: Math.floor(Date.now() / 1000) },
    process.env.JWT_SECRET as string,
    { expiresIn: '30m' },
  );
}

describe('POST /api/push/register-device', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.isTokenBlacklisted.mockResolvedValue(false);
    mockDb.getUserById.mockResolvedValue(TEST_USER);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/push/register-device')
      .send({ token: 'fcm-token-abc', platform: 'android' });

    expect(res.status).toBe(401);
  });

  it('stores the token against the authenticated user', async () => {
    const res = await request(app)
      .post('/api/push/register-device')
      .set('Authorization', `Bearer ${accessTokenFor(TEST_USER.id)}`)
      .send({ token: 'fcm-token-abc', platform: 'android' });

    expect(res.status).toBe(200);
    expect(res.body.data.registered).toBe(true);
    expect(mockDb.upsertDeviceToken).toHaveBeenCalledWith({
      user_id:  TEST_USER.id,
      token:    'fcm-token-abc',
      platform: 'android',
    });
  });

  it('rejects an unrecognised platform value', async () => {
    const res = await request(app)
      .post('/api/push/register-device')
      .set('Authorization', `Bearer ${accessTokenFor(TEST_USER.id)}`)
      .send({ token: 'fcm-token-abc', platform: 'windows-phone' });

    expect(res.status).toBe(400);
    expect(mockDb.upsertDeviceToken).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/push/unregister-device', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.isTokenBlacklisted.mockResolvedValue(false);
    mockDb.getUserById.mockResolvedValue(TEST_USER);
  });

  it('removes the token scoped to the authenticated user', async () => {
    const res = await request(app)
      .delete('/api/push/unregister-device')
      .set('Authorization', `Bearer ${accessTokenFor(TEST_USER.id)}`)
      .send({ token: 'fcm-token-abc' });

    expect(res.status).toBe(200);
    expect(res.body.data.unregistered).toBe(true);
    expect(mockDb.deleteDeviceToken).toHaveBeenCalledWith('fcm-token-abc', TEST_USER.id);
  });
});
