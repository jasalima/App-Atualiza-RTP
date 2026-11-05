-- Ata numbers: given at the first save (a new ata has none), and counted only among the atas
-- that were not deleted — deleted atas keep their old number for the audit trail, so the
-- counter of the year starts again from 01 when every previous ata was deleted.
ALTER TABLE meeting_minutes ALTER COLUMN seq DROP NOT NULL;
ALTER TABLE meeting_minutes DROP CONSTRAINT IF EXISTS meeting_minutes_project_id_year_seq_key;
CREATE UNIQUE INDEX IF NOT EXISTS meeting_minutes_number ON meeting_minutes(project_id, year, seq) WHERE deleted_at IS NULL AND seq IS NOT NULL;
