-- Procedure RTP-ASSINATURA-2: append-only, hash-chained evidence of every signature event,
-- and database guards so a signature already given cannot be edited or removed silently.
-- Additive only: no existing row is changed. Earlier signatures keep their records and are
-- shown as signed under the previous procedure (no evidence is rebuilt for them).

CREATE TABLE IF NOT EXISTS signature_evidence_keys (
  key_id text PRIMARY KEY,
  algorithm text NOT NULL CHECK (algorithm = 'Ed25519'),
  public_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signature_evidence (
  seq bigint PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES signature_requests(id),
  signer_id uuid REFERENCES signature_signers(id),
  event text NOT NULL,
  procedure_version text NOT NULL,
  payload text NOT NULL,
  payload_hash text NOT NULL,
  prev_hash text NOT NULL,
  chain_hash text NOT NULL UNIQUE,
  server_signature text,
  key_id text REFERENCES signature_evidence_keys(key_id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signature_evidence_request ON signature_evidence(request_id, seq);

-- Head of the chain: one row, moved only by the chain trigger.
CREATE TABLE IF NOT EXISTS signature_evidence_head (
  id int PRIMARY KEY CHECK (id = 1),
  seq bigint NOT NULL,
  chain_hash text NOT NULL
);
INSERT INTO signature_evidence_head(id, seq, chain_hash)
VALUES (1, 0, encode(public.digest('RTP-EVIDENCIAS-GENESIS', 'sha256'), 'hex')) ON CONFLICT (id) DO NOTHING;

-- The database computes the payload hash and the chain itself: the application cannot choose them.
CREATE OR REPLACE FUNCTION signature_evidence_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE head record;
BEGIN
  SELECT seq, chain_hash INTO head FROM signature_evidence_head WHERE id = 1 FOR UPDATE;
  NEW.seq := head.seq + 1;
  NEW.payload_hash := encode(public.digest(NEW.payload, 'sha256'), 'hex');
  NEW.prev_hash := head.chain_hash;
  NEW.chain_hash := encode(public.digest(head.chain_hash || '|' || NEW.payload_hash, 'sha256'), 'hex');
  NEW.recorded_at := now();
  UPDATE signature_evidence_head SET seq = NEW.seq, chain_hash = NEW.chain_hash WHERE id = 1;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS signature_evidence_chain ON signature_evidence;
CREATE TRIGGER signature_evidence_chain BEFORE INSERT ON signature_evidence FOR EACH ROW EXECUTE FUNCTION signature_evidence_chain();

CREATE OR REPLACE FUNCTION signature_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The head may only move inside the chain trigger (nested call).
  IF TG_TABLE_NAME = 'signature_evidence_head' AND TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Registros de evidência de assinatura não podem ser alterados nem excluídos.' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS signature_evidence_locked ON signature_evidence;
CREATE TRIGGER signature_evidence_locked BEFORE UPDATE OR DELETE ON signature_evidence FOR EACH ROW EXECUTE FUNCTION signature_evidence_immutable();
DROP TRIGGER IF EXISTS signature_evidence_truncate ON signature_evidence;
CREATE TRIGGER signature_evidence_truncate BEFORE TRUNCATE ON signature_evidence FOR EACH STATEMENT EXECUTE FUNCTION signature_evidence_immutable();
DROP TRIGGER IF EXISTS signature_evidence_head_locked ON signature_evidence_head;
CREATE TRIGGER signature_evidence_head_locked BEFORE UPDATE OR DELETE ON signature_evidence_head FOR EACH ROW EXECUTE FUNCTION signature_evidence_immutable();
DROP TRIGGER IF EXISTS signature_evidence_keys_locked ON signature_evidence_keys;
CREATE TRIGGER signature_evidence_keys_locked BEFORE UPDATE OR DELETE ON signature_evidence_keys FOR EACH ROW EXECUTE FUNCTION signature_evidence_immutable();

-- A signature already given is never edited or deleted (also blocks cascades from its request).
CREATE OR REPLACE FUNCTION guard_given_signature() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'signed' THEN RAISE EXCEPTION 'Assinatura registrada não pode ser excluída.' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'signed' AND (NEW.status, NEW.cpf, NEW.signed_at, NEW.ip, NEW.user_agent, NEW.document_hash, NEW.signature_hash, NEW.auth_user_id, NEW.request_id, NEW.step, NEW.name, NEW.role_label)
      IS DISTINCT FROM (OLD.status, OLD.cpf, OLD.signed_at, OLD.ip, OLD.user_agent, OLD.document_hash, OLD.signature_hash, OLD.auth_user_id, OLD.request_id, OLD.step, OLD.name, OLD.role_label) THEN
    RAISE EXCEPTION 'Assinatura registrada não pode ser alterada.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS signature_given_guard ON signature_signers;
CREATE TRIGGER signature_given_guard BEFORE UPDATE OR DELETE ON signature_signers FOR EACH ROW EXECUTE FUNCTION guard_given_signature();

-- A completed request keeps its document hash, code and date; it may only be cancelled.
CREATE OR REPLACE FUNCTION guard_completed_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'completed' OR EXISTS (SELECT 1 FROM signature_signers WHERE request_id = OLD.id AND status = 'signed') THEN
      RAISE EXCEPTION 'Solicitação com assinaturas não pode ser excluída; cancele-a.' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'completed' AND ((NEW.document_hash, NEW.verification_code, NEW.completed_at, NEW.source_kind, NEW.source_id, NEW.project_id)
      IS DISTINCT FROM (OLD.document_hash, OLD.verification_code, OLD.completed_at, OLD.source_kind, OLD.source_id, OLD.project_id)
      OR NEW.status NOT IN ('completed', 'cancelled')) THEN
    RAISE EXCEPTION 'Solicitação concluída não pode ser alterada; apenas cancelada.' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('cancelled', 'rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Solicitação encerrada não pode ser reaberta.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS signature_request_guard ON signature_requests;
CREATE TRIGGER signature_request_guard BEFORE UPDATE OR DELETE ON signature_requests FOR EACH ROW EXECUTE FUNCTION guard_completed_request();

-- Life-cycle events (completion, cancellation, refusal) enter the same chain, written by the database.
CREATE OR REPLACE FUNCTION signature_request_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO signature_evidence(request_id, event, procedure_version, payload)
    VALUES (NEW.id, 'request_' || NEW.status, 'RTP-ASSINATURA-2', jsonb_build_object(
      'event', 'request_' || NEW.status, 'requestId', NEW.id, 'previousStatus', OLD.status, 'status', NEW.status,
      'documentHash', NEW.document_hash, 'verificationCode', NEW.verification_code, 'reason', NEW.closed_reason,
      'atUtc', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS signature_request_event ON signature_requests;
CREATE TRIGGER signature_request_event AFTER UPDATE OF status ON signature_requests FOR EACH ROW EXECUTE FUNCTION signature_request_event();

CREATE OR REPLACE FUNCTION signature_signer_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    INSERT INTO signature_evidence(request_id, signer_id, event, procedure_version, payload)
    VALUES (NEW.request_id, NEW.id, 'signer_rejected', 'RTP-ASSINATURA-2', jsonb_build_object(
      'event', 'signer_rejected', 'requestId', NEW.request_id, 'signerId', NEW.id, 'step', NEW.step, 'name', NEW.name,
      'reason', NEW.reject_reason, 'atUtc', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS signature_signer_event ON signature_signers;
CREATE TRIGGER signature_signer_event AFTER UPDATE OF status ON signature_signers FOR EACH ROW EXECUTE FUNCTION signature_signer_event();

-- An issued ata version keeps its content, hash and code; only its status may change.
CREATE OR REPLACE FUNCTION guard_minute_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Versão emitida de ata não pode ser excluída.' USING ERRCODE = '23514'; END IF;
  IF (NEW.content, NEW.content_hash, NEW.public_code, NEW.version, NEW.minute_id) IS DISTINCT FROM (OLD.content, OLD.content_hash, OLD.public_code, OLD.version, OLD.minute_id) THEN
    RAISE EXCEPTION 'Versão emitida de ata não pode ser alterada; reabra a ata para emitir nova versão.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS minute_version_guard ON meeting_minute_versions;
CREATE TRIGGER minute_version_guard BEFORE UPDATE OR DELETE ON meeting_minute_versions FOR EACH ROW EXECUTE FUNCTION guard_minute_version();

-- Official PDFs issued for an ata stay registered for the file verification.
CREATE OR REPLACE FUNCTION guard_minute_render() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Registro de PDF emitido não pode ser alterado nem excluído.' USING ERRCODE = '23514'; END;
$$;
DROP TRIGGER IF EXISTS minute_render_guard ON meeting_minute_renders;
CREATE TRIGGER minute_render_guard BEFORE UPDATE OR DELETE ON meeting_minute_renders FOR EACH ROW EXECUTE FUNCTION guard_minute_render();

ALTER TABLE signature_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_evidence_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_evidence_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signature_evidence, signature_evidence_head, signature_evidence_keys FROM authenticated;
