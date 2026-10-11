import mongoose from 'mongoose';
import config from '../config/env.js';
import { supportsTransactions } from '../services/conversion.service.js';

/**
 * GET /api/v1/health
 *
 * Public endpoint used by load balancers and orchestrators. It reports the
 * application status and database connectivity but never exposes credentials,
 * host names or driver internals.
 */
export const healthCheck = async (_req, res) => {
  const startedAt = Date.now();
  const databaseConnected = mongoose.connection.readyState === 1;

  let transactionsAvailable = false;
  if (databaseConnected) {
    try {
      transactionsAvailable = await supportsTransactions();
    } catch {
      transactionsAvailable = false;
    }
  }

  const status = databaseConnected ? 200 : 503;

  return res.status(status).json({
    success: databaseConnected,
    message: databaseConnected
      ? 'CRM Sales Management API is healthy'
      : 'CRM Sales Management API is running but the database is not connected',
    data: {
      status: databaseConnected ? 'ok' : 'degraded',
      service: config.appName,
      version: config.appVersion,
      environment: config.env,
      uptimeSeconds: Math.round(process.uptime()),
      database: {
        connected: databaseConnected,
        state: ['disconnected', 'connected', 'connecting', 'disconnecting'][
          mongoose.connection.readyState
        ],
        transactionsSupported: transactionsAvailable,
      },
      responseTimeMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
  });
};

export default healthCheck;