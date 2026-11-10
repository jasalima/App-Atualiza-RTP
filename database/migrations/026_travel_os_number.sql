-- Nº da OS FAPTO de cada prestação de contas de diária ("WEB:99999/2026"). Goes in the e-mail to the
-- FAPTO so the analyst finds the diária. Not part of the signed Formulário 26 content, so it can be
-- filled in after signing (the travel_signed_content trigger does not watch this column).
ALTER TABLE travel_reports ADD COLUMN IF NOT EXISTS os_number text NOT NULL DEFAULT '';
ALTER TABLE travel_reports DROP CONSTRAINT IF EXISTS travel_reports_os_number;
ALTER TABLE travel_reports ADD CONSTRAINT travel_reports_os_number CHECK (os_number = '' OR os_number ~ '^WEB:[0-9]{1,8}/[0-9]{4}$');
