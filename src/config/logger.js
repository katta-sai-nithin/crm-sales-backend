/**
 * Structured application logging (Pino).
 *
 * Sensitive values are redacted at the logger level so that accidental logging of
 * a request body containing a password or a token cannot leak it.
 */
import pino from 'pino';
import config from './env.js';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  '*.password',
  '*.passwordHash',
  '*.token',
];

const transport =
  config.logging.pretty && !config.isTest
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname,serviceName',
        },
      }
    : undefined;

const logger = pino({
  level: config.logging.level,
  redact: {
    paths: redactPaths,
    censor: '[redacted]',
  },
  base: {
    service: 'crm-sales-api',
    env: config.env,
  },
  ...(transport ? { transport } : {}),
});

export default logger;