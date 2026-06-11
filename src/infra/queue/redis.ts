/**
 * Redis Connection
 *
 * Returns a singleton ioredis client when REDIS_URL is set.
 * Returns null in local dev — every job dispatcher falls back to
 * inline execution automatically (no Redis required to develop).
 *
 * BullMQ requires { maxRetriesPerRequest: null } — do not remove it.
 */

import Redis from 'ioredis';
import { env } from '../../core/config/env';
import { logger } from '../logger';

let _client: Redis | null = null;

export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;

  if (!_client) {
    _client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,  // required by BullMQ
      enableReadyCheck:     false,
      lazyConnect:          false,
    });

    _client.on('connect', () =>
      logger.info('✅ Redis connected')
    );
    _client.on('error', (err: Error) =>
      logger.error('Redis connection error', { message: err.message })
    );
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
