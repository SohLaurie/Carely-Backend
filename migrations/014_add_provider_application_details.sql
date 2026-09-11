-- Migration 014: Add application details to providers and users table
ALTER TABLE providers ADD COLUMN IF NOT EXISTS date_of_birth VARCHAR(50);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS experience VARCHAR(100);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS available_days TEXT[];
ALTER TABLE providers ADD COLUMN IF NOT EXISTS reference_name VARCHAR(150);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS reference_phone VARCHAR(50);

ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(20);

-- Update Nfor Raissa with her application details
UPDATE providers
SET
  date_of_birth = '1998-05-14',
  gender = 'Female',
  experience = '3–5 years',
  available_days = ARRAY['Monday', 'Wednesday', 'Saturday'],
  reference_name = 'Mr. Kamoni',
  reference_phone = '+237 677 889 900'
WHERE id = (SELECT id FROM users WHERE email = 'nforraissa@gmail.com');

UPDATE users
SET
  date_of_birth = '1998-05-14',
  gender = 'Female'
WHERE email = 'nforraissa@gmail.com';