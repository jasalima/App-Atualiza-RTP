-- Project document management: categories, titles, versions, validity and
-- logical deletion for stored files, plus filled travel accountability reports.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
-- A new version points to the document it replaces; the chain keeps every version.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS replaces_id uuid REFERENCES documents(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS valid_until date;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_by text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS delete_reason text;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check CHECK (category IN
  ('work_plan','evidence','contract','minutes','official_letter','invoice','certificate','technical','report','other'));

UPDATE documents SET category = CASE kind WHEN 'individual_work_plan' THEN 'work_plan' WHEN 'evidence' THEN 'evidence' ELSE 'other' END
  WHERE category = 'other';
UPDATE documents SET title = original_name WHERE title = '';

CREATE UNIQUE INDEX IF NOT EXISTS documents_single_successor ON documents(replaces_id) WHERE replaces_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_project_live ON documents(project_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_validity ON documents(project_id, valid_until) WHERE deleted_at IS NULL AND valid_until IS NOT NULL;

-- Filled Formulário 26 (relatório de viagem). Server routes are the only access path.
CREATE TABLE IF NOT EXISTS travel_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  scholar_id uuid NOT NULL REFERENCES scholars(id),
  origin text NOT NULL DEFAULT '',
  destination text NOT NULL DEFAULT '',
  departure_date date,
  return_date date,
  payment_date date,
  objective text NOT NULL DEFAULT '',
  entries jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (return_date IS NULL OR departure_date IS NULL OR return_date >= departure_date)
);
CREATE INDEX IF NOT EXISTS travel_reports_project ON travel_reports(project_id, updated_at DESC) WHERE deleted_at IS NULL;
ALTER TABLE travel_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON travel_reports FROM authenticated;
