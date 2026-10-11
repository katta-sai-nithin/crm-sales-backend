/**
 * Async handler wrapper.
 *
 * Express 5 forwards rejected promises to the error middleware automatically, but
 * the explicit wrapper keeps the behaviour obvious and stable across versions.
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;