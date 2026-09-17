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

    // Ensure CareCredit tables exist
    pool.query(`
      CREATE TABLE IF NOT EXISTS carecredit_wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        balance INTEGER NOT NULL DEFAULT 0,
        held INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_cc_wallets_user ON carecredit_wallets(user_id);

      CREATE TABLE IF NOT EXISTS carecredit_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(30) NOT NULL,
        amount INTEGER NOT NULL,
        booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
        referral_id UUID,
        payment_campay_ref TEXT,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_cc_txn_user ON carecredit_transactions(user_id);

      CREATE TABLE IF NOT EXISTS referral_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code TEXT NOT NULL UNIQUE,
        owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_codes_owner ON referral_codes(owner_id);

      CREATE TABLE IF NOT EXISTS referrals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        referral_code_id UUID NOT NULL REFERENCES referral_codes(id),
        referrer_id UUID NOT NULL REFERENCES users(id),
        referee_id UUID NOT NULL UNIQUE REFERENCES users(id),
        booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
        discount_amount INTEGER NOT NULL DEFAULT 5,
        reward_amount INTEGER NOT NULL DEFAULT 5,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
      CREATE INDEX IF NOT EXISTS idx_referrals_referee ON referrals(referee_id);

      -- Seed existing active approved providers with 80 CareCredits
      INSERT INTO carecredit_wallets (user_id, balance, held)
      SELECT p.id, 80, 0
      FROM providers p
      WHERE p.approval_status = 'approved' AND p.subscription_paid = true
      ON CONFLICT (user_id) DO UPDATE SET balance = 80, held = 0, updated_at = now();
    `).catch(e => console.warn('CareCredit tables migration notice:', e.message))



  }
})

module.exports = pool
