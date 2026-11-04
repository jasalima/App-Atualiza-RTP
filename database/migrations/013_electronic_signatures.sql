-- Signature-only accounts never read project data through the Data API.
CREATE OR REPLACE FUNCTION public.can_access_project(target_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_project_access a
    WHERE a.auth_user_id = (SELECT auth.user_id())
      AND a.role <> 'signer'
      AND (a.project_id = target_project OR a.role = 'admin')
      AND NOT EXISTS (
        SELECT 1 FROM managed_users u
        WHERE u.auth_user_id = a.auth_user_id
          AND (u.revoked_at IS NOT NULL OR u.must_change_password)
      )
  );
$$;

-- CPF informed by each signer; later signatures must use the same one.
CREATE TABLE signer_profiles (
  auth_user_id text PRIMARY KEY,
  cpf text NOT NULL CHECK (cpf ~ '^[0-9]{11}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One request per document collects the signatures in order (member, then coordination).
CREATE TABLE signature_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  source_kind text NOT NULL CHECK (source_kind IN ('travel','rtp')),
  source_id uuid NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','rejected','cancelled')),
  document_hash text,
  verification_code text UNIQUE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  closed_reason text
);
CREATE UNIQUE INDEX signature_requests_one_open ON signature_requests(source_kind, source_id) WHERE status = 'pending';
CREATE INDEX signature_requests_source ON signature_requests(source_kind, source_id, created_at DESC);

CREATE TABLE signature_signers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  step int NOT NULL CHECK (step > 0),
  auth_user_id text NOT NULL,
  name text NOT NULL,
  role_label text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','pending','signed','rejected')),
  cpf text CHECK (cpf ~ '^[0-9]{11}$'),
  signed_at timestamptz,
  ip text,
  user_agent text,
  document_hash text,
  signature_hash text,
  reject_reason text,
  UNIQUE (request_id, step),
  UNIQUE (request_id, auth_user_id)
);
CREATE INDEX signature_signers_user ON signature_signers(auth_user_id, status);

-- Photos the member inserts in the "Registro fotográfico" page of the travel report.
ALTER TABLE travel_reports ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]';

ALTER TABLE signer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_signers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signer_profiles, signature_requests, signature_signers FROM authenticated;

-- A member link through a signature-only account does not allow writing execution records.
DROP POLICY executions_create ON execution_records;
CREATE POLICY executions_create ON execution_records FOR INSERT TO authenticated WITH CHECK (
  can_manage_project(project_id) OR EXISTS (SELECT 1 FROM user_project_access a WHERE a.auth_user_id=(SELECT auth.user_id()) AND a.role <> 'signer' AND a.scholar_id=execution_records.scholar_id)
);
DROP POLICY executions_update ON execution_records;
CREATE POLICY executions_update ON execution_records FOR UPDATE TO authenticated USING (
  can_manage_project(project_id) OR EXISTS (SELECT 1 FROM user_project_access a WHERE a.auth_user_id=(SELECT auth.user_id()) AND a.role <> 'signer' AND a.scholar_id=execution_records.scholar_id)
);
