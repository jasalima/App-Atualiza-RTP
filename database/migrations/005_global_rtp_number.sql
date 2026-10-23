-- RTP numbers form one sequence per project and year (01/2026, 02/2026, …) shared by
-- every scholar, and a number is never reused, not even after a report is deleted.
-- Replaces the per-scholar uniqueness from 003.
DROP INDEX IF EXISTS reports_scholar_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS reports_project_number_key ON reports(project_id, number);
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_number_format;
ALTER TABLE reports ADD CONSTRAINT reports_number_format CHECK (number ~ '^[0-9]{2,}/[0-9]{4}$') NOT VALID;
