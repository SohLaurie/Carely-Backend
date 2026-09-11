require('dotenv').config()
const pool = require('../src/config/db')
const bcrypt = require('bcryptjs')

// Mirrors the 7 providers from E:\Carely Frontend\src\data.js
const PROVIDERS = [
  {
    firstName: 'Marie-Claire', lastName: 'Nkomo',
    email: 'marie@carely.cm', phone: '+237691000001',
    city: 'Yaounde',
    specialties: ['nursing', 'elderly_care'],
    bio: 'Certified nurse with 8 years of experience in home care for elderly and post-operative patients. Specialized in post-surgical care and chronic disease management. Fluent in French and English.',
    pricePerHour: 3500, location: 'Bastos, Yaounde', serviceArea: 'Yaounde — 10 km radius',
    experienceYrs: 8, languages: ['French', 'English', 'Bassa'],
    certifications: ['ID Verified', 'State Nursing Diploma', 'First Aid Certified', 'Palliative Care', 'References Checked'],
    photoUrl: 'https://images.unsplash.com/photo-1627328543975-3f0ba8a823b0?w=400&h=400&fit=crop&auto=format',
    isAvailable: true, rating: 4.9, reviewCount: 47, responseTime: '< 2h',
  },
  {
    firstName: 'Fatima', lastName: 'Bello',
    email: 'fatima@carely.cm', phone: '+237691000002',
    city: 'Douala',
    specialties: ['babysitting'],
    bio: 'Certified early childhood educator with 5 years of experience. I care for children aged 6 months to 10 years with age-appropriate educational activities. Bilingual.',
    pricePerHour: 2800, location: 'Akwa, Douala', serviceArea: 'Douala — 8 km radius',
    experienceYrs: 5, languages: ['French', 'English', 'Hausa'],
    certifications: ['ID Verified', 'Certified Educator', 'Pediatric First Aid', 'References Checked'],
    photoUrl: 'https://images.unsplash.com/photo-1579255565889-2ac16e9b2950?w=400&h=400&fit=crop&auto=format',
    isAvailable: true, rating: 4.8, reviewCount: 63, responseTime: '< 1h',
  },
  {
    firstName: 'Elise', lastName: 'Fouda',
    email: 'elise@carely.cm', phone: '+237691000003',
    city: 'Yaounde',
    specialties: ['cleaning', 'laundry_ironing'],
    bio: 'Expert housekeeper with over 6 years of experience. Meticulous and discreet, bringing eco-friendly products. Full cleaning, ironing, and organization.',
    pricePerHour: 2200, location: 'Omnisports, Yaounde', serviceArea: 'Yaounde — 15 km radius',
    experienceYrs: 6, languages: ['French', 'Ewondo'],
    certifications: ['ID Verified', 'References Checked (12 families)'],
    photoUrl: 'https://images.unsplash.com/photo-1677195063105-276fd4b95b21?w=400&h=400&fit=crop&auto=format',
    isAvailable: true, rating: 4.7, reviewCount: 89, responseTime: '< 3h',
  },
  {
    firstName: 'Paul', lastName: 'Mbarga',
    email: 'paul@carely.cm', phone: '+237691000004',
    city: 'Douala',
    specialties: ['nursing', 'elderly_care'],
    bio: 'Certified nurse specialized in geriatrics and home care. 6 years supporting elderly patients and those in rehabilitation. Empathetic and rigorous.',
    pricePerHour: 3200, location: 'Bonanjo, Douala', serviceArea: 'Douala — 12 km radius',
    experienceYrs: 6, languages: ['French', 'English', 'Beti'],
    certifications: ['ID Verified', 'State Nursing Diploma', 'Geriatrics Certified', 'First Aid Certified'],
    photoUrl: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=400&h=400&fit=crop&auto=format',
    isAvailable: false, rating: 4.6, reviewCount: 31, responseTime: '< 4h',
  },
  {
    firstName: "Samuel", lastName: "Eto'o Nkodo",
    email: 'samuel@carely.cm', phone: '+237691000005',
    city: 'Yaounde',
    specialties: ['gardening', 'outdoor_cleaning'],
    bio: 'Professional gardener and landscaper with 7 years of experience. Specializing in lawn grooming, hedge trimming, flower planting, and organic garden maintenance.',
    pricePerHour: 2500, location: 'Mvan, Yaounde', serviceArea: 'Yaounde — 15 km radius',
    experienceYrs: 7, languages: ['French', 'English'],
    certifications: ['ID Verified', 'Horticulture Certificate', 'References Checked'],
    photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&auto=format',
    isAvailable: true, rating: 4.9, reviewCount: 42, responseTime: '< 1h',
  },
  {
    firstName: 'Nathalie', lastName: 'Eyenga',
    email: 'nathalie@carely.cm', phone: '+237691000006',
    city: 'Douala',
    specialties: ['pet_care'],
    bio: 'Passionate animal caregiver with 4+ years of veterinary assistant experience. Specializing in dog walking, feeding routines, medication administration.',
    pricePerHour: 2000, location: 'Bonamoussadi, Douala', serviceArea: 'Douala — 10 km radius',
    experienceYrs: 4, languages: ['French', 'English'],
    certifications: ['ID Verified', 'Vet Assistant Diploma', 'Pet First Aid'],
    photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=400&fit=crop&auto=format',
    isAvailable: true, rating: 4.8, reviewCount: 38, responseTime: '< 2h',
  },
  {
    firstName: 'Chef Brigitte', lastName: 'Manga',
    email: 'brigitte@carely.cm', phone: '+237691000007',
    city: 'Douala',
    specialties: ['cooking'],
    bio: 'Professional home chef and dietary nutritionist with 9 years of culinary experience. Specializing in Cameroonian traditional meals, healthy diabetic/low-sodium diets, and weekly family meal prepping.',
    pricePerHour: 3000, location: 'Bonapriso, Douala', serviceArea: 'Douala — 15 km radius',
    experienceYrs: 9, languages: ['French', 'English', 'Duala'],
    certifications: ['ID Verified', 'Culinary Arts Diploma', 'Hygiene & Food Safety'],
    photoUrl: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=400&h=400&fit=crop&auto=format',
    isAvailable: true, rating: 4.9, reviewCount: 56, responseTime: '< 1h',
  },
]

async function seed() {
  const hash = await bcrypt.hash('Provider1!', 12)
  let created = 0
  let skipped = 0

  for (const p of PROVIDERS) {
    const dbClient = await pool.connect()
    try {
      await dbClient.query('BEGIN')

      // Upsert user
      const { rows: [user] } = await dbClient.query(
        `INSERT INTO users (role, first_name, last_name, email, phone, password_hash, city)
         VALUES ('provider', $1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO UPDATE SET updated_at = now()
         RETURNING id, (xmax = 0) AS inserted`,
        [p.firstName, p.lastName, p.email, p.phone, hash, p.city]
      )

      // Only create provider profile if user was newly inserted
      if (user.inserted) {
        await dbClient.query(
          `INSERT INTO providers
             (id, specialties, bio, price_per_hour, location, service_area,
              experience_yrs, languages, certifications, photo_url,
              is_available, approval_status, rating, review_count, response_time)
           VALUES
             ($1, $2::specialty[], $3, $4, $5, $6, $7, $8, $9, $10, $11, 'approved', $12, $13, $14)
           ON CONFLICT (id) DO NOTHING`,
          [
            user.id, p.specialties, p.bio, p.pricePerHour,
            p.location, p.serviceArea, p.experienceYrs,
            p.languages, p.certifications, p.photoUrl,
            p.isAvailable, p.rating, p.reviewCount, p.responseTime,
          ]
        )
        created++
        console.log(`  ✅ Created: ${p.firstName} ${p.lastName} (${p.email})`)
      } else {
        skipped++
        console.log(`  ⏭️  Skipped (already exists): ${p.email}`)
      }

      await dbClient.query('COMMIT')
    } catch (err) {
      await dbClient.query('ROLLBACK')
      console.error(`  ❌ Failed for ${p.email}:`, err.message)
    } finally {
      dbClient.release()
    }
  }

  console.log(`\n🎉 Seed complete — ${created} created, ${skipped} skipped.`)
  process.exit(0)
}

console.log('🌱 Seeding 7 providers from data.js...\n')
seed().catch(err => { console.error(err); process.exit(1) })
