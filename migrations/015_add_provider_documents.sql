-- Migration 015: Add document columns to providers
ALTER TABLE providers ADD COLUMN IF NOT EXISTS id_document_url VARCHAR(500);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS id_document_name VARCHAR(255);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS police_clearance_url VARCHAR(500);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS police_clearance_name VARCHAR(255);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS certificate_url VARCHAR(500);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS certificate_name VARCHAR(255);

-- Update Nfor Raissa with her documents
UPDATE providers
SET
  id_document_url = '/uploads/documents/cni_laurie.pdf',
  id_document_name = 'CNI laurie.pdf',
  police_clearance_url = '/uploads/documents/police_clearance_raissa.pdf',
  police_clearance_name = 'casier_judiciaire_raissa.pdf',
  certificate_url = '/uploads/documents/certificate_cleaner.pdf',
  certificate_name = 'cert_cleaner.pdf'
WHERE id = (SELECT id FROM users WHERE email = 'nforraissa@gmail.com');
