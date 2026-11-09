-- E-mail of the signed accountability reports (Formulário 26) to the FAPTO analyst, through Resend.
-- One configuration per project: recipients and the message model with {{placeholders}}.
CREATE TABLE project_email_settings (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  recipients text[] NOT NULL DEFAULT '{}',
  cc text[] NOT NULL DEFAULT '{}',
  subject_template text NOT NULL,
  body_template text NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every e-mail sent: which reports went, to whom, by whom, and the Resend id.
CREATE TABLE email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  source_kind text NOT NULL CHECK (source_kind IN ('travel')),
  source_ids uuid[] NOT NULL,
  recipients text[] NOT NULL,
  cc text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  provider_id text,
  status text NOT NULL CHECK (status IN ('sending','sent','failed')),
  error text,
  sent_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_deliveries_sources ON email_deliveries USING gin(source_ids);
CREATE INDEX email_deliveries_project ON email_deliveries(project_id, created_at DESC);

ALTER TABLE project_email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON project_email_settings, email_deliveries FROM authenticated;
