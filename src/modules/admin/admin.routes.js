const { Router } = require('express')
const auth = require('../../middleware/auth')
const requireRole = require('../../middleware/requireRole')
const ctrl = require('./admin.controller')

const router = Router()

// All admin routes require authentication + admin role
router.use(auth, requireRole('admin'))

/**
 * GET /api/admin/providers
 * List provider applications with optional status filter (?status=all|pending|approved|rejected)
 */
router.get('/providers', ctrl.listProviders)

/**
 * GET /api/admin/users
 * List real user accounts (clients, caregivers, admins)
 */
router.get('/users', ctrl.listUsers)

/**
 * GET /api/admin/providers/pending
 * List all provider applications awaiting review.
 */
router.get('/providers/pending', ctrl.listPendingProviders)

/**
 * PATCH /api/admin/providers/:id/approve
 * Approve a provider application. Triggers 25 XAF Campay subscription collect.
 */
router.patch('/providers/:id/approve', ctrl.approveProvider)

/**
 * PATCH /api/admin/providers/:id/reject
 * Reject a provider application.
 */
router.patch('/providers/:id/reject', ctrl.rejectProvider)

/**
 * POST /api/admin/subscription/confirm
 * Campay webhook confirms subscription payment was SUCCESSFUL.
 */
router.post('/subscription/confirm', ctrl.confirmSubscription)

/**
 * GET /api/admin/stats
 * Overview stats for the admin dashboard.
 */
router.get('/stats', ctrl.getStats)

/**
 * Settings & Security Lockout Policy
 */
router.get('/settings/lockout-policy', ctrl.getLockoutPolicy)
router.put('/settings/lockout-policy', ctrl.updateLockoutPolicy)
router.post('/settings/lockout-policy', ctrl.updateLockoutPolicy)

/**
 * Security Audit & Login Attempts
 */
router.get('/security/login-attempts', ctrl.listLoginAttempts)

/**
 * Manual Admin Unlock
 */
router.post('/users/:id/unlock', ctrl.unlockUser)

/**
 * Two-Factor Authentication Policy Settings
 */
router.get('/settings/2fa', ctrl.getTwoFactorPolicy)
router.put('/settings/2fa', ctrl.updateTwoFactorPolicy)
router.post('/settings/2fa', ctrl.updateTwoFactorPolicy)

/**
 * Per-User 2FA Toggle
 */
router.patch('/users/:id/2fa', ctrl.updateUser2FA)

module.exports = router

