import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';

/**
 * Per test-file database isolation.
 *
 * Each test file gets its OWN database on the shared in-memory replica set, so
 * that files running in parallel can never wipe each other's fixtures. The name is
 * derived from the test file path and must be set BEFORE `src/config/env.js` is
 * imported (hence the dynamic imports below).
 */
const testFile = process.env.VITEST_TEST_FILE || expect.getState()?.testPath || 'unknown';
const suffix = crypto.createHash('sha1').update(testFile).digest('hex').slice(0, 10);
const dbName = `crm_sales_test_${suffix}`;

process.env.MONGO_DB_NAME = dbName;

const mongoose = (await import('mongoose')).default;
const { connectDatabase, disconnectDatabase } = await import('../../src/config/database.js');
const { resetLoginAttempts } = await import('../../src/middleware/rateLimiter.js');

beforeAll(async () => {
  await connectDatabase();

  // Hard safety guard: destructive cleanup must never run against a database
  // that is not a dedicated test database.
  if (mongoose.connection.name !== dbName || !mongoose.connection.name.includes('test')) {
    throw new Error(
      `Refusing to run tests: connected to database "${mongoose.connection.name}" instead of "${dbName}". ` +
        'No data will be deleted.'
    );
  }

  // Build the indexes explicitly (autoIndex can be off in test configuration).
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.createIndexes().catch(() => undefined))
  );
});

afterAll(async () => {
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await disconnectDatabase();
});

beforeEach(async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
  resetLoginAttempts();
});

export { dbName };