const authService = require('./auth.service')

// ── POST /api/auth/register ────────────────────────────────────────────────────
async function registerClient(req, res, next) {
  try {
    const result = await authService.registerClient(req.body)
    return res.status(201).json({
      message: 'Client account created successfully.',
      ...result,
    })
  } catch (err) {
    next(err)
  }
}

// ── POST /api/auth/register/provider ──────────────────────────────────────────
// Only treat as an account upgrade if req.user is present AND req.body.isUpgrade === true.
// If req.body.email is provided for a fresh registration, it ALWAYS creates a new provider.
async function registerProvider(req, res, next) {
  try {
    let existingUserId = null
    if (req.user && req.body.isUpgrade === true) {
      existingUserId = req.user.id
    }
    const result = await authService.registerProvider(req.body, existingUserId)

    const message = existingUserId
      ? 'Account successfully upgraded to provider.'
      : 'Provider account created successfully.'

    return res.status(existingUserId ? 200 : 201).json({ message, ...result })
  } catch (err) {
    next(err)
  }
}


// ── POST /api/auth/login ───────────────────────────────────────────────────────
async function login(req, res, next) {
  try {
    const { email, password } = req.body
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress || '127.0.0.1'
    const userAgent = req.headers['user-agent'] || 'Unknown'
    const result = await authService.login(email, password, ip, userAgent)
    return res.status(200).json({
      message: 'Login successful.',
      ...result,
    })
  } catch (err) {
    next(err)
  }
}

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body
    const result = await authService.refreshToken(refreshToken)
    return res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

// ── POST /api/auth/forgot-password ─────────────────────────────────────────────
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body
    const result = await authService.forgotPassword(email)
    return res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

// ── POST /api/auth/verify-reset-code ──────────────────────────────────────────
async function verifyResetCode(req, res, next) {
  try {
    const { code } = req.body
    const result = await authService.verifyResetCode(code)
    return res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

// ── POST /api/auth/reset-password ──────────────────────────────────────────────
async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body
    const result = await authService.resetPassword(token, newPassword)
    return res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

// ── POST /api/auth/verify-2fa ──────────────────────────────────────────────────
async function verify2FA(req, res, next) {
  try {
    const { tempToken, code } = req.body
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress || '127.0.0.1'
    const userAgent = req.headers['user-agent'] || 'Unknown'
    const result = await authService.verify2FA(tempToken, code, ip, userAgent)
    return res.status(200).json({
      message: '2FA authentication successful.',
      ...result,
    })
  } catch (err) {
    next(err)
  }
}

// ── POST /api/auth/resend-2fa ──────────────────────────────────────────────────
async function resend2FA(req, res, next) {
  try {
    const { tempToken } = req.body
    const result = await authService.resend2FA(tempToken)
    return res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

module.exports = {
  registerClient,
  registerProvider,
  login,
  verify2FA,
  resend2FA,
  refresh,
  forgotPassword,
  verifyResetCode,
  resetPassword,
}


