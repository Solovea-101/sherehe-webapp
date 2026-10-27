import nextJest from 'next/jest.js';

// next/jest compiles TypeScript with SWC and reads the @/* alias from tsconfig.json.
const createJestConfig = nextJest({ dir: './' });

export default createJestConfig({
  testEnvironment: 'node',
  // partner-tests/ run separately against Ujuzi's live server (`npm run test:partner`).
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/__tests__/helpers/setupEnv.ts'],
  // Runs the API tests against PostgreSQL when asked to (see the file); otherwise does nothing.
  setupFilesAfterEnv: ['<rootDir>/__tests__/helpers/pgSuite.ts'],
  testTimeout: 30000,
});
