/**
 * Thrown by services/controllers for expected, user-facing failures
 * (bad input, business-rule violations, not-found, etc). Anything
 * else is treated as an unexpected 500.
 */
class AppError extends Error {
  constructor(message, statusCode = 400, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, details: err.details });
  }

  // Postgres unique_violation
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Duplicate value violates a uniqueness constraint' });
  }
  // Postgres foreign_key_violation
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced record does not exist' });
  }
  // Postgres check_violation
  if (err.code === '23514') {
    return res.status(400).json({ error: 'Value violates a database constraint' });
  }

  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { AppError, errorHandler };
