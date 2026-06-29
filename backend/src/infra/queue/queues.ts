import { Queue }                    from 'bullmq';
import { env }                      from '../../core/config/env';
import { logger }                   from '../logger';
import { REDIS_CONNECTION_OPTIONS } from './redis';

const log = logger.child({ module: 'queue' });

export const QUEUE_NAME = 'vachix:background';

let _queue: Queue | null        = null;
let _ready: Promise<Queue> | null = null;

// Returns null when Redis is not configured.
// Awaits waitUntilReady() on first call so callers never race the connection.
export async function getBackgroundQueue(): Promise<Queue | null> {
  if (!env.REDIS_URL) return null;

  if (!_ready) {
    const q = new Queue(QUEUE_NAME, {
      connection: { ...REDIS_CONNECTION_OPTIONS, url: env.REDIS_URL },
      defaultJobOptions: {
        attempts:         3,
        backoff:          { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 200 },
        removeOnFail:     { count: 100 },
      },
    });

    q.on('error', (err: Error) =>
      log.error('BullMQ queue error', { queue: QUEUE_NAME, error: err.message })
    );

    _ready = q.waitUntilReady().then(() => {
      _queue = q;
      return q;
    });
  }

  return _ready;
}

export async function closeQueue(): Promise<void> {
  if (_ready) {
    const q = await _ready;
    await q.close();
    _queue = null;
    _ready = null;
  }
}

// Alert thresholds: waiting > 500 = backlog growing; failed > 50 = systemic regression.
export async function getQueueDepth(): Promise<Record<string, number> | null> {
  const queue = await getBackgroundQueue();
  if (!queue) return null;

  const [waiting, active, delayed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getDelayedCount(),
    queue.getFailedCount(),
  ]);

  return { waiting, active, delayed, failed };
}
