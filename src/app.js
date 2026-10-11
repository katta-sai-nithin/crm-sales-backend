import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import crypto from 'node:crypto';
import config from './config/env.js';
import logger from './config/logger.js';
import { swaggerSpec } from './config/swagger.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRateLimiter } from './middleware/rateLimiter.js';

const app = express();

/**
 * Behind a reverse proxy (Render, Railway, Nginx, Cloudflare) `req.ip` must come
 * from `X-Forwarded-For` for rate limiting to work per client.
 */
app.set('trust proxy', config.security.trustProxy);
app.disable('x-powered-by');

/**
 * Security headers.
 * CSP is configured explicitly because Swagger UI needs inline styles/scripts.
 */
app.use(
  helmet({
    contentSecurityPolicy: config.swagger.enabled
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            fontSrc: ["'self'", 'data:'],
          },
        }
      : true,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
  })
);

/**
 * CORS allowlist.
 *
 * Two rules:
 *  1. Same-origin requests are always allowed. The API serves its own Swagger UI
 *     (`/api-docs`) and the browser sends `Origin: http://localhost:5000` for
 *     those XHR calls, which would otherwise be rejected by the allowlist.
 *     Same-origin traffic is not a cross-site threat, so it is not restricted.
 *  2. A cross-origin request from an unknown origin is **not** answered with an
 *     error. CORS is enforced by the browser, so the correct behaviour is to
 *     omit the CORS headers and let the browser block the response - never a
 *     5xx. Non-browser clients (curl, Postman, health probes) send no `Origin`
 *     at all and are unaffected.
 */
const allowedOrigins = new Set(config.cors.origins);
const allowAllOrigins = allowedOrigins.has('*');

const CORS_BASE_OPTIONS = {
  credentials: config.cors.credentials,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['RateLimit', 'RateLimit-Policy', 'X-Request-Id'],
  maxAge: 600,
};

/**
 * True when the request's `Origin` header points at this very server.
 * Comparing hosts is proxy-safe and does not depend on scheme detection.
 */
function isSameOrigin(req, origin) {
  const host = req.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Dynamic CORS options. The delegate form of `cors()` receives the request, which
 * the plain `origin` callback does not - it is what makes same-origin detection
 * possible.
 */
function corsOptionsDelegate(req, callback) {
  const requestOrigin = req.get('Origin');
  let origin = false;

  if (requestOrigin) {
    if (allowAllOrigins || isSameOrigin(req, requestOrigin) || allowedOrigins.has(requestOrigin)) {
      // Reflect the concrete origin (never "*", which is illegal with credentials).
      origin = requestOrigin;
    } else {
      logger.warn({ origin: requestOrigin, host: req.get('host') }, 'CORS origin rejected');
    }
  }

  callback(null, { ...CORS_BASE_OPTIONS, origin });
}

app.use(cors(corsOptionsDelegate));

app.use(express.json({ limit: config.security.jsonLimit }));
app.use(express.urlencoded({ extended: true, limit: config.security.jsonLimit }));
app.use(cookieParser());

/**
 * Assign a request id used in every log line.
 */
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

/**
 * Structured HTTP request logging (Pino). Health checks are skipped to avoid
 * flooding the log during container orchestration probes.
 */
app.use(
  (req, res, next) => {
    if (req.path === '/api/v1/health' || req.originalUrl === '/api-docs') return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info(
        {
          req: { method: req.method, url: req.originalUrl },
          res: { statusCode: res.statusCode },
          userId: req.userId,
          responseTime: Math.round(durationMs * 100) / 100,
          requestId: req.id,
        },
        'request completed'
      );
    });
    next();
  }
);

if (config.rateLimit.enabled) {
  app.use('/api', apiRateLimiter);
}

if (config.swagger.enabled) {
  app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      explorer: true,
      customSiteTitle: 'CRM Sales Management API',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    })
  );
}

app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: `${config.appName} v${config.appVersion}`,
    data: {
      documentation: config.swagger.enabled ? '/api-docs' : null,
      health: '/api/v1/health',
      apiBase: '/api/v1',
    },
  });
});

app.use('/api/v1', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;