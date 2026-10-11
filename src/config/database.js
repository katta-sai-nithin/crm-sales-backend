/**
 * Mongoose connection management.
 *
 * The connection string is never logged in full; only the redacted host and the
 * resolved database name are reported.
 */
import mongoose from 'mongoose';
import config from './env.js';
import logger from './logger.js';

let connectionPromise = null;

/**
 * Produce a log-safe representation of the MongoDB URI (no credentials).
 */
export function sanitizeMongoUri(uri) {
  try {
    const parsed = new URL(uri);
    const auth = parsed.username
      ? `${parsed.username}:${parsed.password ? '***' : ''}@`
      : '';
    const host = parsed.host ? parsed.host.replace(/:\d+$/, (match) => match) : '';
    const dbName = parsed.pathname.replace(/^\//, '');
    return `${parsed.protocol}//${auth}${host}${dbName ? `/${dbName}` : ''}`;
  } catch {
    return 'mongodb://[unparseable-uri]';
  }
}

/**
 * Connect to MongoDB. Idempotent: repeated calls reuse the same promise.
 */
export async function connectDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectionPromise) return connectionPromise;

  mongoose.set('strictQuery', true);
  // NoSQL injection defence is layered rather than delegated to
  // `mongoose.sanitizeFilter` (which would also rewrite the legitimate operator
  // queries used internally by the analytics aggregations):
  //   1. Express 5 parses query strings with the "simple" parser, so
  //      `?email[$ne]=x` stays a literal key instead of becoming an operator.
  //   2. Every query string is validated by a strict Zod schema, so only
  //      known keys with known primitive types ever reach a service.
  //   3. Services build Mongo filters from explicit allowlists and cast values
  //      themselves (see src/utils/query.js) - a raw request object is never
  //      forwarded into a query.
  //   4. Request bodies are validated by strict Zod object schemas, so operator
  //      objects such as `{ "$ne": null }` cannot be smuggled in the body.
  mongoose.set('sanitizeFilter', false);

  const options = {
    serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMS,
    maxPoolSize: config.mongo.maxPoolSize,
    autoIndex: !config.isProduction,
  };
  if (config.mongo.dbName) options.dbName = config.mongo.dbName;

  logger.info(
    { mongoUri: sanitizeMongoUri(config.mongo.uri) },
    'Connecting to MongoDB...'
  );

  connectionPromise = mongoose
    .connect(config.mongo.uri, options)
    .then((m) => {
      logger.info(
        { db: m.connection.name, host: m.connection.host },
        'MongoDB connection established'
      );
      return m.connection;
    })
    .catch((error) => {
      connectionPromise = null;
      // The error message from the driver can contain the connection string, so we
      // log only the error name and a generic description.
      logger.error(
        { errName: error.name, reason: error.message?.replace(/mongodb(\+srv)?:\/\/[^ ]+/gi, 'mongodb://[redacted]') },
        'MongoDB connection failed'
      );
      throw error;
    });

  return connectionPromise;
}

/**
 * Close the connection gracefully.
 */
export async function disconnectDatabase() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.connection.close(false);
  connectionPromise = null;
  logger.info('MongoDB connection closed');
}

mongoose.connection.on('error', (error) => {
  logger.error({ errName: error.name }, 'MongoDB connection error');
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
});

export default connectDatabase;