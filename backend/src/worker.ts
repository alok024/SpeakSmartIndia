/**
 * Worker entry point — delegates to the actual worker in infra/queue.
 * This file exists so Railway/the build can reference `src/worker.ts`
 * as a top-level entry point while keeping all worker logic colocated
 * with its dependencies under src/infra/queue/.
 */
export { startBackgroundWorker } from './infra/queue/worker';
