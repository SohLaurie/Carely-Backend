/**
 * Role-based access guard.
 * Usage: router.get('/admin-only', auth, requireRole('admin'), controller)
 * Multiple roles: requireRole('admin', 'provider')
 *
 * Role hierarchy:
 *  - 'client'   → can access client routes
 *  - 'provider' → can access client routes + provider routes (superset)
 *  - 'admin'    → can access everything
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated.' })
    }

    const { role } = req.user

    // Admin can always pass through
    if (role === 'admin') return next()

    // Provider inherits all client permissions
    // So if the required role is 'client', a 'provider' also passes
    if (roles.includes('client') && role === 'provider') return next()

    // Otherwise check if the user's role is in the allowed list
    if (roles.includes(role)) return next()

    return res.status(403).json({
      error: `Access denied. Required role: ${roles.join(' or ')}.`,
    })
  }
}

module.exports = requireRole
