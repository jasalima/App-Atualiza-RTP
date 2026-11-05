-- Meeting minutes (atas de reunião): institutional editor, simultaneous signatures and
-- public verification by QR Code. Signatures reuse signature_requests/signature_signers.

-- Atas are signed by every participant at once, in any order ("parallel").
-- Travel reports and RTPs keep the ordered flow ("sequential", the default).
ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'sequential';
ALTER TABLE signature_requests DROP CONSTRAINT IF EXISTS signature_requests_mode_check;
ALTER TABLE signature_requests ADD CONSTRAINT signature_requests_mode_check CHECK (mode IN ('sequential','parallel'));
ALTER TABLE signature_requests DROP CONSTRAINT IF EXISTS signature_requests_source_kind_check;
ALTER TABLE signature_requests ADD CONSTRAINT signature_requests_source_kind_check CHECK (source_kind IN ('travel','rtp','minutes'));

-- The editable ata. Number "ATA Nº 001/2026" is sequential per project and year.
CREATE TABLE meeting_minutes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  year int NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  seq int NOT NULL CHECK (seq > 0),
  title text NOT NULL DEFAULT 'ATA DE REUNIÃO – EQUIPE DO PROJETO',
  subject text NOT NULL DEFAULT '',
  meeting_date date,
  starts_at time,
  ends_at time,
  modality text NOT NULL DEFAULT 'online' CHECK (modality IN ('online','presencial','hibrida')),
  location text NOT NULL DEFAULT '',
  platform text NOT NULL DEFAULT '',
  chaired_by text NOT NULL DEFAULT '',
  drafted_by text NOT NULL DEFAULT '',
  objective text NOT NULL DEFAULT '',
  place text NOT NULL DEFAULT 'Palmas, TO',
  header jsonb NOT NULL DEFAULT '{}',
  intro jsonb,              -- null: opening paragraph written from the fields
  topics jsonb NOT NULL DEFAULT '[]',
  decisions jsonb,
  next_meeting jsonb NOT NULL DEFAULT '{}',
  closing jsonb,            -- null: closing paragraph written from the fields
  attachments jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','editing','finalized','archived','cancelled')),
  status_reason text,
  created_by text NOT NULL,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (project_id, year, seq)
);
CREATE INDEX meeting_minutes_project ON meeting_minutes(project_id, meeting_date DESC) WHERE deleted_at IS NULL;

-- Who attended. The registration of each person (scholars, accounts) is never changed here.
CREATE TABLE meeting_minute_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minute_id uuid NOT NULL REFERENCES meeting_minutes(id) ON DELETE CASCADE,
  position int NOT NULL CHECK (position >= 0),
  scholar_id uuid REFERENCES scholars(id),
  auth_user_id text,
  name text NOT NULL,
  institution text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  attendance text NOT NULL DEFAULT 'present' CHECK (attendance IN ('present','absent','justified','guest')),
  signs boolean NOT NULL DEFAULT false,
  CHECK (NOT signs OR (attendance IN ('present','guest') AND auth_user_id IS NOT NULL)),
  UNIQUE (minute_id, position)
);
CREATE INDEX meeting_minute_participants_person ON meeting_minute_participants(scholar_id);
CREATE INDEX meeting_minute_participants_user ON meeting_minute_participants(auth_user_id);

-- Frozen versions: what is signed and verified. The content never changes after insert;
-- content_hash = SHA-256 of {kind:'minutes', sourceId: id, content} (same rule as the other documents).
CREATE TABLE meeting_minute_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minute_id uuid NOT NULL REFERENCES meeting_minutes(id),
  version int NOT NULL CHECK (version > 0),
  content jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  public_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','cancelled')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by text NOT NULL,
  closed_at timestamptz,
  UNIQUE (minute_id, version)
);
CREATE UNIQUE INDEX meeting_minute_versions_one_active ON meeting_minute_versions(minute_id) WHERE status = 'active';

-- Official PDFs issued for a version, one per signature state, kept to check uploaded files.
CREATE TABLE meeting_minute_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES meeting_minute_versions(id),
  state_key text NOT NULL,
  signatures int NOT NULL DEFAULT 0,
  pdf_sha256 text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  size_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, state_key)
);
CREATE INDEX meeting_minute_renders_sha ON meeting_minute_renders(pdf_sha256);

-- Requests per IP and minute on the public verification routes.
CREATE TABLE public_rate_limits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  hits int NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, window_start)
);

-- Server routes only: nothing here is exposed through the Data API.
ALTER TABLE meeting_minutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_minute_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_minute_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_minute_renders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON meeting_minutes, meeting_minute_participants, meeting_minute_versions, meeting_minute_renders, public_rate_limits FROM authenticated;
