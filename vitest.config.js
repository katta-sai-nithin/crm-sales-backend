import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // `forks` keeps the worker processes simple and makes the replica-set
    // connection string exported by globalSetup available to every test file.
    pool: 'forks',
    globalSetup: ['./tests/setup/globalSetup.js'],
    setupFiles: ['./tests/setup/setup.js'],
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules/**', 'tests/**/*.setup.js'],
    testTimeout: 30000,
    hookTimeout: 120000,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/**', 'tests/**', 'src/scripts/**'],
    },
  },
});