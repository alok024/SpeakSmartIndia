/**
 * Jest global setup — runs before any test file imports application code.
 *
 * Loads tests/.env.test via dotenv so env.ts (which calls process.exit(1)
 * via Zod on missing required vars) initialises cleanly in the test process.
 * All values are fake-but-schema-valid — nothing here makes a real network call.
 *
 * Why dotenv instead of Object.assign(process.env, {...})?\
 *   — A single .env.test file is the canonical truth for test credentials.
 *     Both this setup file and any CI --env-file flag can point at the same
 *     source rather than duplicating the list in two places.
 *
 * NODE_ENV is also forced here (belt-and-suspenders alongside jest.config.js)
 * because env.ts evaluates at module-import time. If NODE_ENV is not 'test'
 * when app.ts is first imported, the app.listen() guard will fire and bind
 * port 3001, causing EADDRINUSE across concurrent Jest workers.
 */

import dotenv from 'dotenv';
import path   from 'path';

// Belt-and-suspenders: jest.config.js already sets this before workers start,
// but setting it here too ensures correctness even if jest.config.js is ever
// simplified or the config is changed to a format that doesn't run top-level code.
process.env.NODE_ENV = 'test';

dotenv.config({ path: path.join(__dirname, '.env.test') });
