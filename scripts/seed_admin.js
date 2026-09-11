require('dotenv').config()
const bcrypt = require('bcryptjs')
const pool = require('../src/config/db')

async function seedAdmin() {
  const hash = await bcrypt.hash('Tech123@', 12)
  await pool.query(
    `INSERT INTO users (role, first_name, last_name, email, phone, password_hash, city)
     VALUES ('admin', 'Carely', 'Admin', 'carelycorp237@gmail.com', '+237699000000', $1, 'Yaounde')
     ON CONFLICT (email)
     DO UPDATE SET role = 'admin', password_hash = $1`,
    [hash]
  )
  console.log('✅ Admin user ready: carelycorp237@gmail.com / Tech123@')
  process.exit(0)
}

seedAdmin().catch(err => {
  console.error(err)
  process.exit(1)
})
