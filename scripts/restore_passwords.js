require('dotenv').config()
const pool = require('../src/config/db')
const bcrypt = require('bcryptjs')

async function restore() {
  const hash = await bcrypt.hash('SecurePass1!', 12)
  await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hash, 'laurie@example.com'])
  console.log('Restored Laurie password to SecurePass1!')
  await pool.end()
}

restore().catch(err => {
  console.error(err)
  process.exit(1)
})
