/**
 * Worker Entry Point
 *
 * Run as a separate Railway service:
 *   Start command: node dist/worker.js
 *
 * In Railway: create a second service in the same project pointing
 * to the same repo. Set its start command to `npm run worker`.
 * Both services share the same env vars (including REDIS_URL).
 *
 * Handles SIGTERM gracefully so in-progress jobs finish before
 * the process exits (important during Railway redeploys).
 */

// Load env validation first — exits early if any required var is missing
import './core/config/env';

import { startBackgroundWorker } from './infra/queue/worker';
import { closeRedis }            from './infra/queue/redis';
import { closeQueue }            from './infra/queue/queues';
import { logger }                from './infra/logger';

logger.info('Worker process starting...');

const worker = startBackgroundWorker();

if (!worker) {
  logger.error('Worker could not start — REDIS_URL is not set');
  process.exit(1);
}

// ── Graceful shutdown ─────────────────────────────────────────────
// Railway sends SIGTERM before killing the process.
// worker.close() lets running jobs finish (up to the grace period).

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down worker gracefully`);
  try {
    await worker.close();
    await closeQueue();
    await closeRedis();
    logger.info('Worker shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Error during worker shutdown', { error: err });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception in worker', { error: err.message, stack: err.stack });
  process.exit(1);
});
