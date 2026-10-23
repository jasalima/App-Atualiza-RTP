-- Review workflow: a resolved validation must carry the reviewer's justification,
-- and plans keep an explicit human confirmation before feeding report generation.

ALTER TABLE validations ADD COLUMN IF NOT EXISTS resolution_note text NOT NULL DEFAULT '';
ALTER TABLE work_plans ADD COLUMN IF NOT EXISTS confirmed_by text;

-- RTP numbering is per scholar (RTP 01/2026 exists once for each scholar), so a
-- batch can issue the same number to every selected scholar.
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_project_id_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS reports_scholar_number_key ON reports(scholar_id, number) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_plans_scholar_status ON work_plans(scholar_id, status);
CREATE INDEX IF NOT EXISTS idx_validations_open ON validations(report_id) WHERE resolved_at IS NULL;
