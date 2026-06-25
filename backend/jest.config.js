// Force NODE_ENV before any worker or module evaluation.
// env.ts runs at import-time (module-level Zod parse of process.env).
// If NODE_ENV isn't 'test' at that point, the app.listen() guard in app.ts
// evaluates to false and the server binds port 3001 — causing EADDRINUSE
// when multiple test files import app in the same Jest run.
// Setting it here in jest.config.js ensures it's already in process.env
// before the Jest runner spawns workers AND before dotenv in tests/setup.ts runs.
process.env.NODE_ENV = 'test';

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: false } }],
  },
  // Runs before any test module is imported — loads .env.test so env.ts
  // validates cleanly without real credentials.
  setupFiles: ['<rootDir>/tests/setup.ts'],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts'],
};
