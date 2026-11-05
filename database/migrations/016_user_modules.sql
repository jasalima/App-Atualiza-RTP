-- Modules enabled per account and project, on top of what the profile already includes
-- (e.g. "Atas de Reunião" for a signature-only member). Managed by the administration.
CREATE TABLE user_modules (
  auth_user_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id),
  module text NOT NULL CHECK (module IN ('minutes')),
  granted_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auth_user_id, project_id, module)
);
ALTER TABLE user_modules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_modules FROM authenticated;
