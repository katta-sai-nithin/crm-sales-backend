import mongoose from 'mongoose';
import { ApiError } from './ApiError.js';

/**
 * Return true when the value is a syntactically valid ObjectId.
 */
export function isValidObjectId(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

/**
 * Assert that a value is a valid ObjectId or throw an ApiError.
 */
export function assertObjectId(value, fieldName = 'id') {
  if (!isValidObjectId(value)) {
    throw ApiError.badRequest(`Invalid ${fieldName}: must be a valid 24 character ObjectId`, {
      errors: [{ field: fieldName, message: 'Invalid identifier' }],
    });
  }
  return value;
}

/**
 * Build a `{$in: [...]}` value list, dropping anything that is not a valid id so
 * that a malformed filter can never widen a query.
 */
export function toIdList(ids) {
  if (!ids) return [];
  const list = Array.isArray(ids) ? ids : [ids];
  return list.filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)));
}

/**
 * Cast a value to an ObjectId instance or return null.
 */
export function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.Types.ObjectId.isValid(String(value))) return new mongoose.Types.ObjectId(String(value));
  return null;
}

/**
 * Convert a single ObjectId to its string form (or null).
 */
export function idToString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}