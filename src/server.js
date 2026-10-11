import http from 'node:http';
import mongoose from 'mongoose';
import config, { validateEnv } from './config/env.js';
import logger from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import app from './app.js';
import { registerProcessErrorHandlers } from './middleware/errorHandler.js';
import { startJobs, stopJobs } from './jobs/index.js';

let server;
let isShuttingDown = false;

/**
 * Actionable guidance for the most common startup failure.
 */
function portInUseMessage(port, error) {
  return [
    '',
    `Port ${port} is already in use (${error.code}).`,
    'Another instance of this API - or an unrelated process - is already listening there.',
    '',
    'Fix it with one of:',
    '  1. Find and stop the process holding the port:',
    `       npm run free-port${process.env.PORT && Number(process.env.PORT) !== port ? ` -- --port ${port}` : ''}`,
    '  2. Kill it immediately:',
    `       npm run free-port -- --kill${process.env.PORT && Number(process.env.PORT) !== port ? ` -- --port ${port}` : ''}`,
    '  3. Or simply run on a different port:',
    `       PORT=${port + 1} npm run dev`,
    '',
  ].join('\n');
}

async function startServer() {
  validateEnv();
  registerProcessErrorHandlers();

  // The server must not report a successful start before the database is ready.
  await connectDatabase();

  if (mongoose.connection.readyState !== 1) {
    throw new Error('Database connection is not established - aborting startup');
  }

  server = http.createServer(app);

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      logger.fatal({ port: config.port, errName: error.name }, portInUseMessage(config.port, error));
    }
    throw error;
  }

  logger.info(
    {
      port: config.port,
      env: config.env,
      docs: config.swagger.enabled ? `http://localhost:${config.port}/api-docs` : null,
    },
    `CRM Sales Management API listening on port ${config.port}`
  );

  if (config.jobs.enabled) startJobs();
  else logger.info('Background jobs are disabled (JOBS_ENABLED=false)');

  return server;
}

/**
 * Graceful shutdown: stop accepting connections, drain in-flight requests,
 * close the database and only then exit.
 */
async function shutdown(signal, exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown started');

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out - forcing exit');
    process.exit(exitCode || 1);
  }, config.shutdownTimeoutMs);
  forceExit.unref();

  try {
    stopJobs();

    if (server) {
      await new Promise((resolve) => server.close(resolve));
      logger.info('HTTP server closed');
    }

    await disconnectDatabase();
    clearTimeout(forceExit);
    process.exit(exitCode);
  } catch (error) {
    logger.error({ err: error }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason instanceof Error ? reason : new Error(String(reason)) }, 'Unhandled rejection');
});

startServer().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start the application');
  process.exit(1);
});

export { app, startServer, shutdown };