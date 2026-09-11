-- Migration 016: Add service_radius and ensure price_per_hour for providers
ALTER TABLE providers ADD COLUMN IF NOT EXISTS service_radius VARCHAR(50) DEFAULT '15 km';

-- Update Nfor Raissa specifically
UPDATE providers
SET
  price_per_hour = 500,
  service_radius = '15 km'
WHERE id = (SELECT id FROM users WHERE email = 'nforraissa@gmail.com');

-- Update any null service_radius
UPDATE providers
SET service_radius = '15 km'
WHERE service_radius IS NULL;
