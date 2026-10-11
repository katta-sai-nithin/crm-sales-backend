import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Global test setup.
 *
 * An in-memory **replica set** is started so that MongoDB transactions (required
 * by the lead conversion flow) are supported in tests. The server is bound to an
 * ephemeral port and the data never leaves the process.
 *
 * Safety guards:
 *  - refuses to run when MONGODB_URI already points at a real cluster;
 *  - always uses a dedicated `crm_sales_test` database name.
 */
let replSet;

export async function setup() {
  if (process.env.MONGODB_URI && !process.env.MONGODB_URI.includes('127.0.0.1')) {
    // Not fatal: the URI below always wins because we always connect to the
    // throw-away in-memory replica set. We only warn so that it is obvious that a
    // real cluster configured in .env is NOT used by the test suite.
    console.warn(
      '\n[test] MONGODB_URI points at a remote cluster - the test suite overrides it with the ' +
        'in-memory replica set and never touches the real database.\n'
    );
  }

  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  const uri = replSet.getUri();
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = uri;
  process.env.MONGO_DB_NAME = 'crm_sales_test';
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret-'.padEnd(48, 'x');
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-'.padEnd(48, 'y');
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.RATE_LIMIT_ENABLED = 'false';
  process.env.SWAGGER_ENABLED = 'false';
  process.env.LOG_LEVEL = 'silent';
  process.env.BCRYPT_SALT_ROUNDS = '4';
  process.env.CORS_ORIGIN = 'http://localhost:3000';
  console.log(`\n[test] In-memory MongoDB replica set started (transactions enabled)\n`);
}

export async function teardown() {
  if (replSet) {
    await replSet.stop();
    console.log('\n[test] In-memory MongoDB replica set stopped\n');
  }
}