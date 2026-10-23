CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_role AS ENUM ('admin', 'coordinator', 'scholar');
CREATE TYPE scholar_status AS ENUM ('active', 'suspended', 'finished');
CREATE TYPE execution_status AS ENUM ('not_started', 'in_progress', 'completed', 'partially_completed', 'delayed', 'rescheduled', 'not_applicable');
CREATE TYPE report_status AS ENUM ('draft', 'pending_review', 'approved', 'exported');
CREATE TYPE severity AS ENUM ('critical', 'attention', 'suggestion');

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  executing_institution text NOT NULL,
  support_foundation text NOT NULL DEFAULT 'Fundação de Apoio Científico e Tecnológico do Tocantins – FAPTO',
  coordinator text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  description text NOT NULL DEFAULT '',
  general_objective text NOT NULL DEFAULT '',
  specific_objectives jsonb NOT NULL DEFAULT '[]',
  goals jsonb NOT NULL DEFAULT '[]',
  schedule jsonb NOT NULL DEFAULT '[]',
  city text NOT NULL DEFAULT 'Palmas – TO',
  status text NOT NULL DEFAULT 'active',
  visual_identity jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (ends_on >= starts_on)
);

CREATE TABLE scholars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  auth_user_id text,
  full_name text NOT NULL,
  role_area text NOT NULL DEFAULT '',
  scholarship_type text NOT NULL DEFAULT '',
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status scholar_status NOT NULL DEFAULT 'active',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(project_id, full_name),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  scholar_id uuid REFERENCES scholars(id),
  kind text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  storage_key text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  extracted_text text,
  extraction_status text NOT NULL DEFAULT 'pending',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE work_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  scholar_id uuid NOT NULL REFERENCES scholars(id),
  document_id uuid REFERENCES documents(id),
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending_review',
  functional_identity text NOT NULL DEFAULT '',
  raw_extraction jsonb NOT NULL DEFAULT '{}',
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scholar_id, version)
);

CREATE TABLE plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_plan_id uuid NOT NULL REFERENCES work_plans(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id),
  scholar_id uuid NOT NULL REFERENCES scholars(id),
  item_type text NOT NULL CHECK (item_type IN ('objective','goal','activity','product','dependency','indicator')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  starts_on date,
  ends_on date,
  source_reference jsonb NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE execution_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  scholar_id uuid NOT NULL REFERENCES scholars(id),
  plan_item_id uuid REFERENCES plan_items(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  planned_activity text NOT NULL DEFAULT '',
  executed_activity text NOT NULL DEFAULT '',
  execution_start date,
  execution_end date,
  product text NOT NULL DEFAULT '',
  result text NOT NULL DEFAULT '',
  status execution_status NOT NULL,
  difficulties text NOT NULL DEFAULT '',
  actions_taken text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (period_end >= period_start)
);

CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES execution_records(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  scholar_id uuid NOT NULL REFERENCES scholars(id),
  number text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  issued_on date NOT NULL,
  length_mode text NOT NULL DEFAULT 'standard' CHECK (length_mode IN ('concise','standard','detailed')),
  status report_status NOT NULL DEFAULT 'draft',
  current_version integer NOT NULL DEFAULT 1,
  created_by text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(project_id, number)
);

CREATE TABLE report_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version integer NOT NULL,
  content jsonb NOT NULL,
  traceability jsonb NOT NULL DEFAULT '{}',
  change_summary text NOT NULL DEFAULT '',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(report_id, version)
);

CREATE TABLE validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  report_version integer NOT NULL,
  severity severity NOT NULL,
  code text NOT NULL,
  message text NOT NULL,
  location text NOT NULL,
  source_reference jsonb NOT NULL DEFAULT '{}',
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  user_id text,
  project_id uuid REFERENCES projects(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scholars_project ON scholars(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_plan_items_scholar ON plan_items(scholar_id, item_type);
CREATE INDEX idx_execution_period ON execution_records(scholar_id, period_start, period_end) WHERE deleted_at IS NULL;
CREATE INDEX idx_reports_scholar ON reports(scholar_id, period_start, period_end) WHERE deleted_at IS NULL;
CREATE INDEX idx_audit_project_time ON audit_logs(project_id, created_at DESC);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER projects_touch BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER scholars_touch BEFORE UPDATE ON scholars FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER executions_touch BEFORE UPDATE ON execution_records FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER reports_touch BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
