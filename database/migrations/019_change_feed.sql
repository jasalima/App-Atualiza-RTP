-- Change feed for live screens: every insert, update or delete on the shared records writes
-- a small event (project, kind of record, id). Open screens ask the server for events newer
-- than the last one they saw and reload what changed. Events older than a day are pruned.
CREATE TABLE change_events (
  id bigserial PRIMARY KEY,
  project_id uuid,
  entity text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_events_at ON change_events(at);

CREATE OR REPLACE FUNCTION log_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; project uuid;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_TABLE_NAME = 'signature_signers' THEN
    SELECT q.project_id INTO project FROM signature_requests q WHERE q.id = r.request_id;
    INSERT INTO change_events(project_id, entity, entity_id, action) VALUES (project, 'signature_requests', r.request_id::text, lower(TG_OP));
  ELSE
    INSERT INTO change_events(project_id, entity, entity_id, action) VALUES (r.project_id, TG_TABLE_NAME, r.id::text, lower(TG_OP));
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER reports_live AFTER INSERT OR UPDATE OR DELETE ON reports FOR EACH ROW EXECUTE FUNCTION log_change();
CREATE TRIGGER travel_reports_live AFTER INSERT OR UPDATE OR DELETE ON travel_reports FOR EACH ROW EXECUTE FUNCTION log_change();
CREATE TRIGGER documents_live AFTER INSERT OR UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION log_change();
CREATE TRIGGER scholars_live AFTER INSERT OR UPDATE OR DELETE ON scholars FOR EACH ROW EXECUTE FUNCTION log_change();
CREATE TRIGGER execution_records_live AFTER INSERT OR UPDATE OR DELETE ON execution_records FOR EACH ROW EXECUTE FUNCTION log_change();
CREATE TRIGGER work_plans_live AFTER INSERT OR UPDATE OR DELETE ON work_plans FOR EACH ROW EXECUTE FUNCTION log_change();
CREATE TRIGGER meeting_minutes_live AFTER INSERT OR UPDATE OR DELETE ON meeting_minutes FOR EACH ROW EXECUTE FUNCTION log_change();
CREATE TRIGGER signature_requests_live AFTER INSERT OR UPDATE OR DELETE ON signature_requests FOR EACH ROW EXECUTE FUNCTION log_change();
CREATE TRIGGER signature_signers_live AFTER INSERT OR UPDATE OR DELETE ON signature_signers FOR EACH ROW EXECUTE FUNCTION log_change();

-- Server routes only.
ALTER TABLE change_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON change_events FROM authenticated;
