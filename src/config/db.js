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

    // Ensure extra profile columns exist on users table
    pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS bio TEXT,
        ADD COLUMN IF NOT EXISTS emergency_contact TEXT,
        ADD COLUMN IF NOT EXISTS secondary_phone TEXT,
        ADD COLUMN IF NOT EXISTS preferred_language TEXT;
    `).catch(e => console.warn('Schema check notice:', e.message))

    // Ensure notifications table exists
    pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        metadata JSONB,
        is_read BOOLEAN NOT NULL DEFAULT false,
        is_archived BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, is_read);
    `).catch(e => console.warn('Notifications table migration notice:', e.message))
  }
})

module.exports = pool
