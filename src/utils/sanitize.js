/**
 * Input sanitisation and defensive helpers used across services.
 */

/**
 * Escape regular expression metacharacters so that a user supplied search term
 * is always matched literally (prevents ReDoS and injection through `$`).
 */
export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a safe, case-insensitive, literal RegExp from a search keyword.
 */
export function buildSearchRegex(keyword, { maxLength = 120 } = {}) {
  const trimmed = String(keyword ?? '').trim().slice(0, maxLength);
  if (!trimmed) return null;
  return new RegExp(escapeRegExp(trimmed), 'i');
}

/**
 * Build a `$or` clause matching a keyword across the given fields.
 * Returns null when no usable keyword is present.
 */
export function buildTextSearchFilter(keyword, fields, options = {}) {
  const regex = buildSearchRegex(keyword, options);
  if (!regex || !fields.length) return null;
  return { $or: fields.map((field) => ({ [field]: regex })) };
}

/**
 * Prune undefined values from an update payload and reject any key that is not
 * part of the allowlist.
 *
 * This is the primary defence against mass assignment: services never spread a
 * raw request body into a model, they pass an explicitly allow-listed object.
 */
export function pickAllowed(source = {}, allowedFields = []) {
  const allowed = new Set(allowedFields);
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (!allowed.has(key)) continue;
    if (value === undefined) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Detect MongoDB operators or dotted paths in user supplied values, which is the
 * signature of a NoSQL injection attempt.
 */
export function containsMongoOperators(value, depth = 0) {
  if (depth > 5 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsMongoOperators(item, depth + 1));
  return Object.keys(value).some(
    (key) => key.startsWith('$') || key.includes('.') || containsMongoOperators(value[key], depth + 1)
  );
}

/**
 * Recursively strip keys starting with `$` from an object.
 */
export function stripMongoOperators(value, depth = 0) {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stripMongoOperators(item, depth + 1));
  const output = {};
  for (const [key, val] of Object.entries(value)) {
    if (key.startsWith('$')) continue;
    output[key] = stripMongoOperators(val, depth + 1);
  }
  return output;
}

/**
 * Convert a Mongoose document / lean object to a plain JSON safe object.
 */
export function toPlain(doc) {
  if (!doc) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return JSON.parse(JSON.stringify(plain));
}

/**
 * Normalise an email address: trimmed and lower-cased so that uniqueness is
 * case-insensitive across the application.
 */
export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : email;
}

/**
 * Serialise an ObjectId (or array of ObjectIds) for API responses.
 */
export function idOf(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => idOf(item));
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

/**
 * Remove properties whose value is `undefined` (useful for `$set` payloads).
 */
export function omitUndefined(object = {}) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}