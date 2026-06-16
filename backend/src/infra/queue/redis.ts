import { env } from '../../core/config/env';
import { logger } from '../logger';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Redis = require('ioredis');

let _client: ReturnType<typeof Redis> | null = null;

export function getRedis(): ReturnType<typeof Redis> | null {
  if (!env.REDIS_URL) return null;

  if (!_client) {
    _client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck:     false,
      lazyConnect:          false,
    });

    _client.on('connect', () => logger.info('✅ Redis connected'));
    _client.on('error',   (err: Error) => logger.error('Redis error', { message: err.message }));
  }

  return _client;
}

export async function closeRedis(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = null;
    logger.info('Redis connection closed');
  }
}