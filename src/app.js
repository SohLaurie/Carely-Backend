const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')

const path = require('path')
const errorHandler    = require('./middleware/errorHandler')
const authRoutes      = require('./modules/auth/auth.routes')
const usersRoutes     = require('./modules/users/users.routes')
const providersRoutes = require('./modules/providers/providers.routes')
const bookingsRoutes  = require('./modules/bookings/bookings.routes')
const sessionsRoutes  = require('./modules/sessions/sessions.routes')
const paymentsRoutes  = require('./modules/payments/payments.routes')
const reviewsRoutes   = require('./modules/reviews/reviews.routes')
const availabilityRoutes = require('./modules/availability/availability.routes')
const adminRoutes        = require('./modules/admin/admin.routes')
const uploadRoutes       = require('./modules/upload/upload.routes')
const discussionsRoutes  = require('./modules/discussions/discussions.routes')
const notificationsRoutes = require('./modules/notifications/notifications.routes')

const app = express()

// ── Security & Utility Middleware ──────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, mobile apps, Render health checks)
    if (!origin) return callback(null, true)
    // Support comma-separated list of allowed origins via FRONTEND_URL env var
    const allowed = (process.env.FRONTEND_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173')
      .split(',').map(s => s.trim())
    if (allowed.includes(origin)) return callback(null, true)
    callback(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
}))
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))
app.use(morgan('dev'))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ── Rate Limiting (auth routes) ────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 500,
  message: { error: 'Too many requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth',         authLimiter, authRoutes)
app.use('/api/users',        usersRoutes)
app.use('/api/providers',    providersRoutes)
app.use('/api/bookings',     bookingsRoutes)
app.use('/api/sessions',     sessionsRoutes)
app.use('/api/payments',     paymentsRoutes)
app.use('/api/reviews',      reviewsRoutes)
app.use('/api/availability', availabilityRoutes)
app.use('/api/admin',        adminRoutes)
app.use('/api/upload',       uploadRoutes)
app.use('/api/discussions',  discussionsRoutes)
app.use('/api/notifications', notificationsRoutes)

// ── Auto-Release Cron (every 5 minutes) ────────────────────────────────────────
// Auto-completes ARRIVED sessions past their 24h deadline and marks overdue
// SCHEDULED sessions as MISSED. Runs in-process — no external scheduler needed.
;(function startAutoReleaseCron() {
  const { autoReleaseExpired } = require('./modules/sessions/sessions.service')
  const INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
  setInterval(async () => {
    try {
      const result = await autoReleaseExpired()
      if (result.autoCompleted > 0 || result.markedMissed > 0) {
        console.log(`[AutoRelease] Completed: ${result.autoCompleted}, Missed: ${result.markedMissed}, Bookings affected: ${result.affectedBookings}`)
      }
    } catch (err) {
      console.warn('[AutoRelease] Error during auto-release:', err.message)
    }
  }, INTERVAL_MS)
  console.log('✅ Auto-release cron started (every 5 minutes)')
})()

// ── Health Check ───────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── 404 ────────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` })
})

// ── Global Error Handler (must be last) ───────────────────────────────────────
app.use(errorHandler)

module.exports = app
