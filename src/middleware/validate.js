/**
 * Zod request body validator middleware factory.
 * Usage: router.post('/route', validate(myZodSchema), controller)
 *
 * On validation failure returns 400 with a clear list of field errors.
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)

    if (!result.success) {
      const issues = result.error.issues || result.error.errors || []
      const errors = issues.map((e) => ({
        field: e.path ? e.path.join('.') : '',
        message: e.message,
      }))
      return res.status(400).json({ error: 'Validation failed', details: errors })
    }

    // Replace req.body with the parsed (and possibly coerced) data
    req.body = result.data
    next()
  }
}

module.exports = validate
