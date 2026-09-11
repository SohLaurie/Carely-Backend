const { Router } = require('express')
const authController = require('./auth.controller')
const validate = require('../../middleware/validate')
const auth = require('../../middleware/auth')
const {
  registerClientSchema,
  registerProviderSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyResetCodeSchema,
  verify2FASchema,
  resend2FASchema,
} = require('./auth.schemas')

const router = Router()

/**
 * POST /api/auth/register
 * Register a new client account.
 */
router.post(
  '/register',
  validate(registerClientSchema),
  authController.registerClient
)

/**
 * POST /api/auth/register/provider
 * Register a fresh provider account OR upgrade an existing client.
 * Auth middleware is optional here — if a valid token is sent, it's an upgrade.
 * If no token is sent, it's a fresh registration.
 *
 * We use a soft-auth pattern: try to decode the token but don't require it.
 */
router.post(
  '/register/provider',
  (req, res, next) => {
    // Soft auth: attempt to verify token but do not block on failure
    const header = req.headers.authorization
    if (header && header.startsWith('Bearer ')) {
      return auth(req, res, next)
    }
    next()
  },
  validate(registerProviderSchema),
  authController.registerProvider
)

/**
 * POST /api/auth/login
 * Login for all roles (client, provider, admin).
 */
router.post(
  '/login',
  validate(loginSchema),
  authController.login
)

/**
 * POST /api/auth/refresh
 * Exchange a valid refresh token for a new access token.
 */
router.post(
  '/refresh',
  validate(refreshSchema),
  authController.refresh
)

/**
 * POST /api/auth/forgot-password
 * Request a password reset link/token.
 */
router.post(
  '/forgot-password',
  validate(forgotPasswordSchema),
  authController.forgotPassword
)

/**
 * POST /api/auth/verify-reset-code
 * Verify recovery code or token validity before resetting.
 */
router.post(
  '/verify-reset-code',
  validate(verifyResetCodeSchema),
  authController.verifyResetCode
)

/**
 * POST /api/auth/reset-password
 * Reset password using the received token or recovery code.
 */
router.post(
  '/reset-password',
  validate(resetPasswordSchema),
  authController.resetPassword
)

/**
 * POST /api/auth/verify-2fa
 * Verify Two-Factor Authentication 6-digit OTP code on login.
 */
router.post(
  '/verify-2fa',
  validate(verify2FASchema),
  authController.verify2FA
)

/**
 * POST /api/auth/resend-2fa
 * Resend fresh 2FA OTP code to user's registered email.
 */
router.post(
  '/resend-2fa',
  validate(resend2FASchema),
  authController.resend2FA
)

module.exports = router

