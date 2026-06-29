import { Queue }                  from 'bullmq';
import { env }                    from '../../core/config/env';
import { logger }                 from '../logger';
import { REDIS_CONNECTION_OPTIONS } from './redis';

const log = logger.child({ module: 'queue' });

export const QUEUE_NAME = 'vachix:background';

let _queue: Queue | null = null;

export function getBackgroundQueue(): Queue | null {
  if (!env.REDIS_URL) return null;

  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: { ...REDIS_CONNECTION_OPTIONS, url: env.REDIS_URL },
      defaultJobOptions: {
        attempts:         3,
        backoff:          { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 200 },
        removeOnFail:     { count: 100 },
      },
    });

    _queue.on('error', (err: Error) =>
      log.error('BullMQ queue error', { queue: QUEUE_NAME, error: err.message })
    );
  }

  return _queue;
}

export async function closeQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
}

// Alert thresholds: waiting > 500 = backlog growing; failed > 50 = systemic regression.
export async function getQueueDepth(): Promise<Record<string, number> | null> {
  const queue = getBackgroundQueue();
  if (!queue) return null;

  const [waiting, active, delayed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getDelayedCount(),
    queue.getFailedCount(),
  ]);

  return { waiting, active, delayed, failed };
}
