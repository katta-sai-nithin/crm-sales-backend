/**
 * Verifies the graceful shutdown path: the HTTP server closes, the database
 * connection is released and the process exits cleanly.
 *
 * Usage: node scripts/shutdownCheck.js
 *
 * Note: `shutdown()` calls process.exit() itself once the sequence has completed,
 * so the last log line to look for is "MongoDB connection closed".
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const { shutdown } = await import('../src/server.js');

setTimeout(() => {
  console.log('[shutdown-check] triggering graceful shutdown (SIGINT path)');
  shutdown('SIGINT', 0);
}, 6000);

setTimeout(() => {
  console.error('[shutdown-check] TIMEOUT - graceful shutdown did not complete');
  process.exit(1);
}, 20000);