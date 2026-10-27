CREATE TABLE project_connectivity_settings (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  evolution_url text NOT NULL,
  encrypted_api_key text NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE project_connectivity_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON project_connectivity_settings FROM authenticated;

CREATE TABLE document_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  auth_user_id text NOT NULL,
  request_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('travel','rtp','document')),
  source_id uuid NOT NULL,
  source_version integer,
  file_name text NOT NULL,
  format text NOT NULL,
  recipient_phone text NOT NULL,
  status text NOT NULL CHECK (status IN ('sending','accepted','uncertain','failed')),
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_user_id,request_id)
);
CREATE INDEX document_deliveries_user_project_time ON document_deliveries(auth_user_id,project_id,created_at DESC);
ALTER TABLE document_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON document_deliveries FROM authenticated;
