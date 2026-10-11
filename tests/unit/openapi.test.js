import { describe, it, expect } from 'vitest';
import request from 'supertest';
import swaggerSpec from '../../src/config/swagger.js';
import app from '../../src/app.js';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'patch', 'delete', 'head', 'options']);

/** Routes that are intentionally public and therefore answered differently. */
const PUBLIC_OPERATIONS = {
  'POST /auth/register': 400, // empty body -> validation error, no account created
  'POST /auth/login': 400, // empty body -> validation error
  'POST /auth/refresh': 400, // empty body -> validation error
  'GET /health': 200,
};

/** Every documented operation: `{ method, path, operationId, op }`. */
function documentedOperations() {
  const operations = [];
  for (const [path, item] of Object.entries(swaggerSpec.paths || {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      operations.push({ method: method.toLowerCase(), path, operationId: op.operationId, op });
    }
  }
  return operations;
}

/** Replace `{param}` placeholders with a syntactically valid ObjectId. */
function concretePath(path) {
  return path.replace(/\{[^}]+\}/g, '507f1f77bcf86cd799439011');
}

describe('OpenAPI document', () => {
  const operations = documentedOperations();

  it('has the required metadata', () => {
    expect(swaggerSpec.openapi).toMatch(/^3\./);
    expect(swaggerSpec.info.title).toBeTruthy();
    expect(swaggerSpec.info.version).toBeTruthy();
    expect(swaggerSpec.servers.length).toBeGreaterThan(0);
  });

  it('declares the bearer security scheme and applies it globally', () => {
    expect(swaggerSpec.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(swaggerSpec.security).toEqual([{ bearerAuth: [] }]);
  });

  it('documents every operation exactly once with a unique operationId', () => {
    expect(operations.length).toBeGreaterThan(40);

    const ids = operations.map((operation) => operation.operationId);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Regression guard for the Swagger UI console warning:
   * "Deprecated: escaping deep link whitespace with `_` is unsupported".
   *
   * Swagger UI builds `#/operations/<tag>/<operationId>` and encodes any
   * whitespace in those segments as `_` (`%20` -> `_`). An identifier without
   * whitespace can therefore never produce a deprecated deep link.
   */
  it('uses operationIds and tags that are free of whitespace and underscores', () => {
    for (const { operationId } of operations) {
      expect(operationId, 'operationId must not contain whitespace').not.toMatch(/\s/);
      expect(operationId, 'operationId must not contain "_"').not.toMatch(/_/);
      expect(operationId, 'operationId must be a safe identifier').toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
    }

    for (const tag of swaggerSpec.tags || []) {
      expect(tag.name, `tag "${tag.name}" must not contain whitespace`).not.toMatch(/\s/);
      expect(tag.name, `tag "${tag.name}" must not contain "_"`).not.toMatch(/_/);
    }
  });

  it('gives every operation a summary and at least one response', () => {
    for (const { method, path, op } of operations) {
      expect(op.summary, `${method.toUpperCase()} ${path} summary`).toBeTruthy();
      expect(Object.keys(op.responses || {}).length, `${method.toUpperCase()} ${path} responses`).toBeGreaterThan(0);
    }
  });

  /**
   * Documentation must never show an undocumented status. Every operation can
   * fail validation (400), and every protected operation needs a token (401).
   */
  it('documents the universal 400 / 401 responses on every operation', () => {
    for (const { method, path, op } of operations) {
      expect(op.responses['400'], `${method.toUpperCase()} ${path} must document 400`).toBeTruthy();

      const isPublic = Array.isArray(op.security) && op.security.length === 0;
      if (isPublic) continue;

      expect(
        op.responses['401'],
        `${method.toUpperCase()} ${path} must document 401`
      ).toBeTruthy();
    }
  });

  /**
   * The documentation must describe endpoints that really exist.
   *
   * Rather than reading Express internals (which are not part of its public API
   * in v5), every documented operation is probed on the real app:
   *  - a protected route must answer 401 when unauthenticated - never 404, which
   *    would mean the documentation describes a route that does not exist;
   *  - the public operations are answered with a deliberately invalid, empty
   *    payload so validation rejects them without creating any data.
   */
  it('documents operations that really exist on the Express app', async () => {
    const results = await Promise.all(
      operations.map(async ({ method, path }) => {
        const key = `${method.toUpperCase()} ${path}`;
        const expected = PUBLIC_OPERATIONS[key] ?? 401;
        const call = request(app)[method]('/api/v1' + concretePath(path));
        const response = await call.send({});
        return { key, expected, actual: response.status };
      })
    );

    const mismatches = results.filter((entry) => entry.actual !== entry.expected);
    expect(
      mismatches.map((entry) => `${entry.key} -> ${entry.actual} (expected ${entry.expected})`),
    ).toEqual([]);
  });
});