/**
 * Global error handler — must be registered LAST in app.js.
 * Catches any error passed via next(err) or thrown in async handlers.
 * Always returns a consistent JSON error shape: { error, ...(details) }
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500
  if (status >= 500) {
    console.error('❌ Server error:', err)
  }

  // Zod errors (in case they bubble up directly)
  if (err.name === 'ZodError') {
    const issues = err.issues || err.errors || []
    return res.status(400).json({
      error: 'Validation failed',
      details: issues.map((e) => ({ field: e.path ? e.path.join('.') : '', message: e.message })),
    })
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Invalid or expired token.' })
  }

  // PostgreSQL unique constraint violation
  if (err.code === '23505') {
    return res.status(409).json({ error: 'A record with that value already exists.' })
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced record does not exist.' })
  }

  // Generic server error
  const message = err.message || 'Internal server error'
  return res.status(status).json({ error: message })
}

module.exports = errorHandler
