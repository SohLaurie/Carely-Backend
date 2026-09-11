require('dotenv').config()
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

async function runMigrations() {
  // Use DATABASE_URL (Neon/production) if available, otherwise individual vars (local dev)
  const clientConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME     || 'carely',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
      }

  const client = new Client(clientConfig)

  await client.connect()
  const dbTarget = process.env.DATABASE_URL ? 'Neon PostgreSQL (DATABASE_URL)' : `${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'carely'}`
  console.log(`✅ Connected to PostgreSQL — ${dbTarget}`)

  // Create migrations tracking table if it doesn't exist
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      filename   VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  const migrationsDir = path.join(__dirname, '..', 'migrations')
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const { rows } = await client.query(
      'SELECT id FROM _migrations WHERE filename = $1',
      [file]
    )

    if (rows.length > 0) {
      console.log(`⏭  Skipping ${file} (already applied)`)
      continue
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    console.log(`🔄 Running ${file}...`)
    await client.query(sql)
    await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file])
    console.log(`✅ Applied ${file}`)
  }

  await client.end()
  console.log('\n🎉 All migrations complete.')
}

runMigrations().catch(err => {
  console.error('❌ Migration failed:', err.message)
  process.exit(1)
})
