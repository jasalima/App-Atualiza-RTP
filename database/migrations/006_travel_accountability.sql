ALTER TABLE scholars ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
ALTER TABLE scholars ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';

-- Credentials remain server-only. One connection per user and project.
CREATE TABLE IF NOT EXISTS project_whatsapp_connections (
  project_id uuid NOT NULL REFERENCES projects(id),
  auth_user_id text NOT NULL,
  instance text NOT NULL,
  api_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, auth_user_id)
);
ALTER TABLE project_whatsapp_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON project_whatsapp_connections FROM authenticated;

CREATE TABLE IF NOT EXISTS travel_document_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  auth_user_id text NOT NULL,
  scholar_id uuid NOT NULL REFERENCES scholars(id),
  request_id uuid NOT NULL,
  status text NOT NULL CHECK(status IN ('sending','accepted','uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(auth_user_id,request_id)
);
ALTER TABLE travel_document_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON travel_document_sends FROM authenticated;
