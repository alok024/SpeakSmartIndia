import { env }    from '../../core/config/env';
import { logger } from '../logger';
import Redis       from 'ioredis';

// BullMQ v5 vendors its own ioredis, so passing a Redis instance across
// the boundary causes a TS structural mismatch. Export raw options instead
// and let each consumer (Queue, Worker) create its own connection.
export const REDIS_CONNECTION_OPTIONS = {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck:     false,
} as const;

let _client: InstanceType<typeof Redis> | null = null;

// App-level client — auth grace cache, session state, etc.
// Do not pass this to BullMQ constructors; use REDIS_CONNECTION_OPTIONS.
export function getRedis(): InstanceType<typeof Redis> | null {
  if (!env.REDIS_URL) return null;

  if (!_client) {
    _client = new Redis(env.REDIS_URL, {
      ...REDIS_CONNECTION_OPTIONS,
      lazyConnect: false,
    });

    _client.on('connect', () => logger.info('Redis connected'));
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
