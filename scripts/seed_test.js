require('dotenv').config()
const pool = require('../src/config/db')
const bcrypt = require('bcryptjs')

async function seed() {
  const hash = await bcrypt.hash('Provider1!', 12)

  const { rows: [user] } = await pool.query(
    `INSERT INTO users (role, first_name, last_name, email, phone, password_hash, city)
     VALUES ('provider', 'Marie-Claire', 'Nkomo', 'marie@carely.cm', '+237691000001', $1, 'Yaounde')
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [hash]
  )

  await pool.query(
    `INSERT INTO providers
       (id, specialties, bio, price_per_hour, location, service_area,
        experience_yrs, languages, certifications, is_available, approval_status, rating, review_count)
     VALUES
       ($1, ARRAY['nursing','elderly_care']::specialty[],
        'Certified nurse with 8 years of experience.', 3500,
        'Bastos, Yaounde', 'Yaounde 10km radius', 8,
        ARRAY['French','English','Bassa'],
        ARRAY['ID Verified','State Nursing Diploma','First Aid Certified'],
        true, 'approved', 4.9, 47)
     ON CONFLICT (id) DO NOTHING`,
    [user.id]
  )

  console.log('Seeded provider ID:', user.id)
  process.exit(0)
}

seed().catch(err => { console.error(err); process.exit(1) })
