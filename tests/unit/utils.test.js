import { describe, it, expect } from 'vitest';
import {
  roundMoney,
  calculateExpectedRevenue,
  sumMoney,
} from '../../src/utils/money.js';
import { escapeRegExp, buildSearchRegex, buildTextSearchFilter, pickAllowed, stripMongoOperators, containsMongoOperators, normalizeEmail } from '../../src/utils/sanitize.js';
import { parsePagination, parseSort, parseDateRange, parseEnum } from '../../src/utils/query.js';
import { isValidObjectId, toObjectId, toIdList } from '../../src/utils/objectId.js';
import { deriveActivityStatus, buildStatusFilter } from '../../src/services/activity.service.js';
import { computeConversionRate } from '../../src/services/analytics.service.js';
import { timespanToSeconds } from '../../src/services/token.service.js';
import { sanitizeMongoUri } from '../../src/config/database.js';
import { ApiError } from '../../src/utils/ApiError.js';
import { normalizeError, humanizeZodIssues } from '../../src/middleware/errorHandler.js';
import { loginSchema } from '../../src/validators/auth.validator.js';
import mongoose from 'mongoose';

describe('money utilities', () => {
  it('rounds half up to 2 decimals', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(10)).toBe(10);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it('calculates expected revenue from integer cents (no float drift)', () => {
    expect(calculateExpectedRevenue(25000, 60)).toBe(15000);
    expect(calculateExpectedRevenue(1000, 33)).toBe(330);
    expect(calculateExpectedRevenue(0.07, 50)).toBe(0.04);
    expect(calculateExpectedRevenue(12345.67, 17)).toBe(2098.76);
  });

  it('returns 0 revenue for 0% probability', () => {
    expect(calculateExpectedRevenue(5000, 0)).toBe(0);
  });

  it('sums amounts with consistent rounding', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    // Each amount is rounded half-up to cents first (1.005 -> 1.01, 2.005 -> 2.01).
    expect(sumMoney([1.005, 2.005])).toBe(3.02);
    expect(sumMoney([19.99, 0.01])).toBe(20);
  });
});

describe('sanitization utilities', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.*b')).toBe('a\\.\\*b');
  });

  it('builds a literal, non-catastrophic regex', () => {
    const regex = buildSearchRegex('(a+)+$');
    expect(regex.test('(a+)+$')).toBe(true);
    expect(regex.test('aaaaaaaaaaaaaaaaaaaaaaaaaaaX')).toBe(false);
  });

  it('returns null for empty keywords', () => {
    expect(buildSearchRegex('   ')).toBeNull();
    expect(buildTextSearchFilter('', ['name'])).toBeNull();
  });

  it('builds a text search filter across fields', () => {
    const filter = buildTextSearchFilter('acme', ['name', 'company']);
    expect(filter.$or).toHaveLength(2);
    expect(filter.$or[0].name).toBeInstanceOf(RegExp);
  });

  it('picks only allow-listed fields (mass assignment protection)', () => {
    const picked = pickAllowed(
      { name: 'x', role: 'ADMIN', passwordHash: 'evil', __proto__: {} },
      ['name']
    );
    expect(picked).toEqual({ name: 'x' });
  });

  it('detects and strips mongo operators', () => {
    expect(containsMongoOperators({ $ne: null })).toBe(true);
    expect(containsMongoOperators({ nested: { $gt: 1 } })).toBe(true);
    expect(containsMongoOperators({ plain: 'value' })).toBe(false);
    expect(stripMongoOperators({ a: 1, $or: [] })).toEqual({ a: 1 });
  });

  it('normalises emails', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
  });
});

describe('query helpers', () => {
  it('defaults pagination', () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 10, skip: 0 });
  });

  it('computes skip', () => {
    expect(parsePagination({ page: '3', limit: '20' })).toEqual({ page: 3, limit: 20, skip: 40 });
  });

  it('rejects invalid and oversized pagination', () => {
    expect(() => parsePagination({ page: '0' })).toThrow(ApiError);
    expect(() => parsePagination({ limit: '500' })).toThrow(/must not exceed 100/i);
    expect(() => parsePagination({ limit: 'abc' })).toThrow(ApiError);
  });

  it('only accepts allow-listed sort fields', () => {
    const allowed = ['name', 'createdAt'];
    expect(parseSort({ sortBy: 'name', sortOrder: 'asc' }, { allowedFields: allowed })).toEqual({
      name: 1,
      _id: -1,
    });
    expect(() => parseSort({ sortBy: 'password' }, { allowedFields: allowed })).toThrow(/sortBy/);
    expect(() => parseSort({ sortOrder: 'sideways' }, { allowedFields: allowed })).toThrow(/sortOrder/);
  });

  it('builds and validates date ranges', () => {
    const range = parseDateRange({ dateFrom: '2026-01-01', dateTo: '2026-02-01' });
    expect(range.$gte).toBeInstanceOf(Date);
    expect(range.$lte).toBeInstanceOf(Date);
    expect(() => parseDateRange({ dateFrom: 'nope' })).toThrow(ApiError);
    expect(() =>
      parseDateRange({ dateFrom: '2026-02-01', dateTo: '2026-01-01' })
    ).toThrow(/earlier than/);
  });

  it('validates enum filters', () => {
    expect(parseEnum('NEW,LOST', ['NEW', 'LOST', 'OTHER'], 'status', { multi: true })).toEqual([
      'NEW',
      'LOST',
    ]);
    expect(() => parseEnum('BOGUS', ['NEW'], 'status')).toThrow(/unsupported value/);
  });
});

describe('object id helpers', () => {
  it('validates ids strictly', () => {
    const id = new mongoose.Types.ObjectId().toString();
    expect(isValidObjectId(id)).toBe(true);
    expect(isValidObjectId('not-an-id')).toBe(false);
    expect(isValidObjectId('123')).toBe(false);
  });

  it('drops invalid ids from lists', () => {
    const id = new mongoose.Types.ObjectId().toString();
    expect(toIdList([id, 'bad', null])).toEqual([id]);
  });

  it('converts to ObjectId or null', () => {
    expect(toObjectId('nope')).toBeNull();
    expect(toObjectId('507f1f77bcf86cd799439011')).toBeInstanceOf(mongoose.Types.ObjectId);
  });
});

describe('activity status derivation', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  it('reports a pending past-due activity as OVERDUE', () => {
    expect(deriveActivityStatus({ status: 'PENDING', dueDate: new Date('2026-05-30') }, now)).toBe('OVERDUE');
  });

  it('never marks a completed activity overdue', () => {
    expect(
      deriveActivityStatus({ status: 'COMPLETED', dueDate: new Date('2020-01-01') }, now)
    ).toBe('COMPLETED');
  });

  it('keeps future activities pending', () => {
    expect(deriveActivityStatus({ status: 'PENDING', dueDate: new Date('2026-07-01') }, now)).toBe(
      'PENDING'
    );
  });

  it('treats an activity without a due date as pending', () => {
    expect(deriveActivityStatus({ status: 'PENDING', dueDate: null }, now)).toBe('PENDING');
  });

  it('builds an OVERDUE filter that excludes completed activities', () => {
    const filter = buildStatusFilter('OVERDUE', now);
    expect(filter.$or[0].status.$ne).toBe('COMPLETED');
    expect(filter.$or[0].dueDate.$lt).toEqual(now);
  });
});

describe('analytics helpers', () => {
  it('is safe for a zero denominator', () => {
    expect(computeConversionRate(5, 0)).toBe(0);
    expect(computeConversionRate(1, 4)).toBe(25);
    expect(computeConversionRate(2, 3)).toBe(66.67);
  });
});

describe('token helpers', () => {
  it('parses timespans into seconds', () => {
    expect(timespanToSeconds('15m')).toBe(900);
    expect(timespanToSeconds('7d')).toBe(604800);
    expect(timespanToSeconds('45s')).toBe(45);
  });
});

describe('mongo uri sanitisation', () => {
  it('removes credentials from the log output', () => {
    const sanitized = sanitizeMongoUri('mongodb+srv://user:secret@cluster.mongodb.net/crm_db');
    expect(sanitized).not.toContain('secret');
    expect(sanitized).toContain('***');
  });

  it('never throws on a malformed uri', () => {
    expect(() => sanitizeMongoUri('not a uri')).not.toThrow();
  });
});

describe('Zod error humanisation', () => {
  const messagesFor = (schema, input, fallback = 'body') => {
    const result = schema.safeParse(input);
    if (result.success) throw new Error('expected the payload to be rejected');
    return humanizeZodIssues(result.error.issues, fallback);
  };

  it('turns a missing field into "<field> is required"', () => {
    const errors = messagesFor(loginSchema, {});
    expect(errors).toEqual([
      { field: 'email', message: 'email is required', code: 'invalid_type' },
      { field: 'password', message: 'password is required', code: 'invalid_type' },
    ]);
  });

  it('never leaks Zod internals such as "Invalid input: expected string"', () => {
    const errors = messagesFor(loginSchema, { password: 'x' });
    expect(JSON.stringify(errors)).not.toMatch(/Invalid input|received undefined/);
  });

  it('keeps schema-authored messages verbatim', () => {
    const errors = messagesFor(loginSchema, { email: 'not-an-email', password: 'x' });
    expect(errors[0]).toMatchObject({ field: 'email', message: 'Must be a valid email address' });
  });

  it('reports at most one message per field', () => {
    const errors = messagesFor(loginSchema, { email: '', password: '' });
    expect(errors).toHaveLength(2);
    expect(errors.filter((error) => error.field === 'email')).toHaveLength(1);
  });

  it('names the request source when the issue has no path', () => {
    const errors = messagesFor(loginSchema, { email: 'a@b.com', password: 'x', role: 'ADMIN' });
    expect(errors[0]).toEqual({
      field: 'body',
      message: 'Unexpected field(s) not allowed: "role"',
      code: 'unrecognized_keys',
    });
  });

  it('pluralises length limits correctly', () => {
    const long = { email: 'a@b.com', password: 'a'.repeat(200) };
    const errors = messagesFor(loginSchema, long);
    expect(errors[0].message).toBe('password must be at most 128 characters');

    const short = { email: '', password: 'x' };
    const shortErrors = messagesFor(loginSchema, short);
    expect(shortErrors[0].message).toBe('email must be at least 3 characters');
  });

  it('is applied end to end by the error normaliser', () => {
    const result = loginSchema.safeParse({});
    const normalized = normalizeError(result.error);
    expect(normalized.status).toBe(400);
    expect(normalized.errors[0].message).toBe('email is required');
  });
});

describe('error normalisation', () => {
  it('maps a duplicate key error to 409', () => {
    const error = normalizeError({ code: 11000, keyValue: { email: 'a@b.com' } });
    expect(error.status).toBe(409);
    expect(error.code).toBe('DUPLICATE_RESOURCE');
  });

  it('maps a cast error to 400', () => {
    const error = normalizeError(new mongoose.Error.CastError('ObjectId', 'xyz', '_id'));
    expect(error.status).toBe(400);
  });

  it('hides internal details from unexpected errors in production terms', () => {
    const error = normalizeError(new Error('mongodb exploded at /secret/path'));
    expect(error.status).toBe(500);
    expect(error.isOperational).toBe(false);
  });

  it('maps malformed JSON to 400', () => {
    const error = normalizeError(Object.assign(new Error('bad json'), { type: 'entity.parse.failed' }));
    expect(error.status).toBe(400);
  });
});