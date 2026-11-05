-- CPF confirmed by administration is bound to one login, never claimed on first signature.
CREATE TABLE signer_identities (
  auth_user_id text PRIMARY KEY,
  cpf text NOT NULL UNIQUE CHECK (cpf ~ '^[0-9]{11}$'),
  phone text NOT NULL DEFAULT '',
  verified_by text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE meeting_minute_participants ADD COLUMN cpf text NOT NULL DEFAULT '';
ALTER TABLE meeting_minute_participants ADD COLUMN phone text NOT NULL DEFAULT '';

-- Guests receive an individual, expiring capability and prove possession of their phone.
CREATE TABLE external_signature_access (
  signer_id uuid PRIMARY KEY REFERENCES signature_signers(id) ON DELETE CASCADE,
  cpf text NOT NULL CHECK (cpf ~ '^[0-9]{11}$'),
  phone text NOT NULL CHECK (phone ~ '^[0-9]{12,15}$'),
  token_hash text NOT NULL UNIQUE,
  encrypted_token text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  challenge_hash text,
  challenge_expires_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  sends int NOT NULL DEFAULT 0,
  sent_at timestamptz,
  verified_at timestamptz,
  proof_hash text,
  proof_expires_at timestamptz
);
ALTER TABLE signer_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_signature_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signer_identities, external_signature_access FROM authenticated;

-- Defense in depth: even a different server path cannot sign with another account's CPF.
CREATE FUNCTION enforce_signature_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'signed' AND OLD.status <> 'signed' THEN
    IF NOT EXISTS (SELECT 1 FROM signature_requests WHERE id=NEW.request_id AND status='pending') THEN
      RAISE EXCEPTION 'Solicitação de assinatura encerrada.' USING ERRCODE='23514';
    END IF;
    IF NEW.auth_user_id LIKE 'external:%' THEN
      IF NOT EXISTS (SELECT 1 FROM external_signature_access e WHERE e.signer_id=NEW.id AND e.cpf=NEW.cpf
          AND e.expires_at>now() AND e.proof_hash IS NOT NULL AND e.proof_expires_at>now())
        OR EXISTS (SELECT 1 FROM signer_identities i WHERE i.cpf=NEW.cpf) THEN
        RAISE EXCEPTION 'Confirmação de identidade externa inválida.' USING ERRCODE='23514';
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM signer_identities i WHERE i.auth_user_id=NEW.auth_user_id AND i.cpf=NEW.cpf) THEN
      RAISE EXCEPTION 'CPF não corresponde à identidade confirmada desta conta.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER signature_identity_check BEFORE UPDATE OF status ON signature_signers
FOR EACH ROW EXECUTE FUNCTION enforce_signature_identity();

-- Content changes and signatures serialize on the same request row.
CREATE FUNCTION guard_signed_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id,status FROM signature_requests
    WHERE source_id=NEW.id AND source_kind=CASE WHEN TG_TABLE_NAME='reports' THEN 'rtp' ELSE 'travel' END
      AND status IN ('pending','completed') FOR UPDATE LOOP
    IF r.status='completed' OR EXISTS(SELECT 1 FROM signature_signers WHERE request_id=r.id AND status='signed') THEN
      RAISE EXCEPTION 'Documento com assinaturas: cancele a solicitação antes de alterar.' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER report_signed_content BEFORE UPDATE OF current_version ON reports
FOR EACH ROW EXECUTE FUNCTION guard_signed_content();
CREATE TRIGGER travel_signed_content BEFORE UPDATE OF origin,destination,departure_date,return_date,payment_date,objective,entries,photos ON travel_reports
FOR EACH ROW EXECUTE FUNCTION guard_signed_content();
