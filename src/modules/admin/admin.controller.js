const adminService = require('./admin.service')

// GET /api/admin/providers?status=all|pending|approved|rejected
async function listProviders(req, res, next) {
  try {
    const { status } = req.query
    const result = await adminService.listApplications({ status })
    res.json(result)
  } catch (err) {
    next(err)
  }
}

// GET /api/admin/users
async function listUsers(req, res, next) {
  try {
    const users = await adminService.listUsers()
    res.json({ users, total: users.length })
  } catch (err) {
    next(err)
  }
}

// GET /api/admin/providers/pending
async function listPendingProviders(req, res, next) {
  try {
    const providers = await adminService.listPendingProviders()
    res.json({ providers, total: providers.length })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/admin/providers/:id/approve
async function approveProvider(req, res, next) {
  try {
    const result = await adminService.approveProvider(req.params.id)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

// PATCH /api/admin/providers/:id/reject
async function rejectProvider(req, res, next) {
  try {
    const result = await adminService.rejectProvider(req.params.id)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

// POST /api/admin/subscription/confirm
// Internal webhook: called when Campay confirms 25 XAF subscription payment
async function confirmSubscription(req, res, next) {
  try {
    const { campay_reference, status } = req.body
    if (!campay_reference) {
      return res.status(400).json({ error: 'campay_reference is required.' })
    }
    if (status !== 'SUCCESSFUL') {
      return res.json({ message: 'Payment not yet successful. Ignored.' })
    }
    const result = await adminService.confirmSubscriptionPayment(campay_reference)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

// GET /api/admin/stats
async function getStats(req, res, next) {
  try {
    const pool = require('../../config/db')
    const [usersR, providersR, bookingsR, pendingR] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users WHERE role != $1', ['admin']),
      pool.query("SELECT COUNT(*) FROM providers WHERE approval_status = 'approved' AND subscription_paid = true"),
      pool.query('SELECT COUNT(*) FROM bookings'),
      pool.query("SELECT COUNT(*) FROM providers WHERE approval_status = 'pending'"),
    ])
    res.json({
      totalUsers:           parseInt(usersR.rows[0].count),
      activeProviders:      parseInt(providersR.rows[0].count),
      totalBookings:        parseInt(bookingsR.rows[0].count),
      pendingApplications:  parseInt(pendingR.rows[0].count),
    })
  } catch (err) {
    next(err)
  }
}

// GET /api/admin/settings/lockout-policy
async function getLockoutPolicy(req, res, next) {
  try {
    const securityService = require('../auth/security.service')
    const policy = await securityService.getLockoutPolicy()
    res.json({ policy })
  } catch (err) {
    next(err)
  }
}

// PUT /api/admin/settings/lockout-policy
async function updateLockoutPolicy(req, res, next) {
  try {
    const securityService = require('../auth/security.service')
    const policy = await securityService.updateLockoutPolicy(req.body)
    res.json({ message: 'Lockout policy updated successfully.', policy })
  } catch (err) {
    next(err)
  }
}

// GET /api/admin/security/login-attempts
async function listLoginAttempts(req, res, next) {
  try {
    const securityService = require('../auth/security.service')
    const logs = await securityService.listLoginAttempts(req.query)
    res.json({ logs, total: logs.length })
  } catch (err) {
    next(err)
  }
}

// POST /api/admin/users/:id/unlock
async function unlockUser(req, res, next) {
  try {
    const securityService = require('../auth/security.service')
    const user = await securityService.unlockUser(req.params.id)
    res.json({ message: `User ${user.email} unlocked successfully.`, user })
  } catch (err) {
    next(err)
  }
}

// GET /api/admin/settings/2fa
async function getTwoFactorPolicy(req, res, next) {
  try {
    const policy = await adminService.getTwoFactorPolicy()
    res.json(policy)
  } catch (err) {
    next(err)
  }
}

// PUT /api/admin/settings/2fa
async function updateTwoFactorPolicy(req, res, next) {
  try {
    const policy = await adminService.updateTwoFactorPolicy(req.body)
    res.json({ message: 'Two-factor authentication policy updated successfully.', policy })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/admin/users/:id/2fa
async function updateUser2FA(req, res, next) {
  try {
    const { enabled } = req.body
    const updated = await adminService.updateUser2FA(req.params.id, enabled)
    res.json({
      message: `Two-factor authentication ${updated.two_factor_enabled ? 'enabled' : 'disabled'} for ${updated.email}.`,
      user: updated,
    })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  listProviders,
  listPendingProviders,
  listUsers,
  approveProvider,
  rejectProvider,
  confirmSubscription,
  getStats,
  getLockoutPolicy,
  updateLockoutPolicy,
  listLoginAttempts,
  unlockUser,
  getTwoFactorPolicy,
  updateTwoFactorPolicy,
  updateUser2FA,
}

