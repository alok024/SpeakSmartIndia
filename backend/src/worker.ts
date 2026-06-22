/**
 * Worker entry point — delegates to the actual worker in infra/queue.
 * This file exists so Railway/the build can reference `src/worker.ts`
 * as a top-level entry point while keeping all worker logic colocated
 * with its dependencies under src/infra/queue/.
 *
 * If Redis is not configured, exits non-zero rather than sitting idle —
 * a silently-idle worker is harder to debug than one that fails fast.
 */
import { startBackgroundWorker } from './infra/queue/worker';
import { logger } from './infra/logger';

const log = logger.child({ module: 'worker-entry' });

const worker = startBackgroundWorker();

if (!worker) {
  // getRedis() returned null — REDIS_URL isn't configured. There is
  // nothing for this process to do (jobs run inline in the API process
  // instead), so exit non-zero rather than sitting "running" while idle —
  // a silently-idle worker process is worse than one that fails fast and
  // makes the misconfiguration visible in deploy logs/health checks.
  log.error('Worker process started but Redis is not configured — exiting. ' +
    'Set REDIS_URL if you intend to run a dedicated background worker.');
  process.exit(1);
}

log.info('Worker process up and consuming the background queue');

// Graceful shutdown — let in-flight jobs finish before the process exits
// (BullMQ's Worker#close waits for active jobs up to its lock duration).
async function shutdown(signal: string): Promise<void> {
  log.info('Worker received shutdown signal, closing...', { signal });
  try {
    await worker.close();
    log.info('Worker closed cleanly');
    process.exit(0);
  } catch (err) {
    log.error('Error while closing worker', { error: (err as Error).message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
