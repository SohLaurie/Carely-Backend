require('dotenv').config()
const pool = require('../src/config/db')

async function cleanup() {
  const { rows } = await pool.query(
    `SELECT id, email FROM users WHERE email IN ('laurie@example.com', 'provider_1788585912519@carely.cm') OR email LIKE 'test_%@carely.cm'`
  )
  const ids = rows.map(r => r.id)
  if (ids.length > 0) {
    await pool.query(`DELETE FROM reviews WHERE reviewer_id = ANY($1) OR provider_id = ANY($1)`, [ids])
    await pool.query(`DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE booker_id = ANY($1) OR provider_id = ANY($1))`, [ids])
    await pool.query(`DELETE FROM sessions WHERE booking_id IN (SELECT id FROM bookings WHERE booker_id = ANY($1) OR provider_id = ANY($1))`, [ids])
    await pool.query(`DELETE FROM bookings WHERE booker_id = ANY($1) OR provider_id = ANY($1)`, [ids])
    await pool.query(`DELETE FROM providers WHERE id = ANY($1)`, [ids])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [ids])
    console.log('✅ Cleaned up mock/test applications successfully!')
  } else {
    console.log('No mock applications found to clean.')
  }
  process.exit(0)
}

cleanup().catch(err => {
  console.error(err)
  process.exit(1)
})
