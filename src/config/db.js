const { Pool } = require('pg')

// ── Connection configuration ────────────────────────────────────────────────
// Neon (production) provides a full connection string via DATABASE_URL.
// Neon connection strings already include `sslmode=require` in the URL, but
// the pg driver also needs ssl: { rejectUnauthorized: false } so Node.js
// accepts Neon's self-signed TLS cert without a CA bundle.
//
// Local development uses individual DB_* vars (no SSL required).

const isProduction = process.env.NODE_ENV === 'production'

const poolConfig = process.env.DATABASE_URL
  ? {
      // Neon / any DATABASE_URL provider
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // required by Neon's TLS cert
    }
  : {
      // Local development (individual env vars)
      host:     process.env.DB_HOST     || 'localhost',
      port:     Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME     || 'carely',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      // Only enable SSL locally if explicitly requested
      ...(isProduction && { ssl: { rejectUnauthorized: false } }),
    }

const pool = new Pool(poolConfig)

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message)
  } else {
    const dbInfo = process.env.DATABASE_URL
      ? 'Neon PostgreSQL (DATABASE_URL)'
      : `${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'carely'}`
    console.log(`✅ Connected to PostgreSQL — ${dbInfo}`)
    release()
  }
})

module.exports = pool
