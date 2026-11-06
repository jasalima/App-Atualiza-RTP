-- Institutional link of each member: UFT or external. It fills the "Instituição" of the atas and
-- lets an external member without an account sign the ata by the public link (CPF + WhatsApp code).
ALTER TABLE scholars ADD COLUMN IF NOT EXISTS affiliation text NOT NULL DEFAULT 'UFT';
ALTER TABLE scholars DROP CONSTRAINT IF EXISTS scholars_affiliation_values;
ALTER TABLE scholars ADD CONSTRAINT scholars_affiliation_values CHECK (affiliation IN ('UFT', 'Externo'));
