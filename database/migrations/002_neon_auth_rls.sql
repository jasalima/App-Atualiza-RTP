-- Neon Data API validates the Neon Auth JWT and exposes its subject through auth.user_id().
-- The application never grants the anonymous role access to institutional data.

CREATE TABLE IF NOT EXISTS user_project_access (
  auth_user_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scholar_id uuid REFERENCES scholars(id) ON DELETE SET NULL,
  role user_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auth_user_id, project_id),
  UNIQUE (scholar_id)
);

ALTER TABLE user_project_access ENABLE ROW LEVEL SECURITY;

ALTER TABLE documents ALTER COLUMN created_by SET DEFAULT auth.user_id();
ALTER TABLE execution_records ALTER COLUMN created_by SET DEFAULT auth.user_id();
ALTER TABLE reports ALTER COLUMN created_by SET DEFAULT auth.user_id();
ALTER TABLE report_versions ALTER COLUMN created_by SET DEFAULT auth.user_id();

CREATE OR REPLACE FUNCTION public.can_access_project(target_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_project_access a
    WHERE a.auth_user_id = (SELECT auth.user_id())
      AND (a.project_id = target_project OR a.role = 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_project(target_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_project_access a
    WHERE a.auth_user_id = (SELECT auth.user_id())
      AND (a.role = 'admin' OR (a.project_id = target_project AND a.role = 'coordinator'))
  );
$$;

CREATE OR REPLACE FUNCTION public.is_project_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_project_access a
    WHERE a.auth_user_id = (SELECT auth.user_id()) AND a.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_project(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_project(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_project(uuid), public.can_manage_project(uuid), public.is_project_admin() TO authenticated;

DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['projects','scholars','documents','work_plans','plan_items','execution_records','reports','audit_logs']
  LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tab); END LOOP;
  FOREACH tab IN ARRAY ARRAY['evidence','report_versions','validations']
  LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tab); END LOOP;
END $$;

CREATE POLICY access_own_memberships ON user_project_access FOR SELECT TO authenticated
  USING (auth_user_id = (SELECT auth.user_id()));

CREATE POLICY projects_read ON projects FOR SELECT TO authenticated USING (can_access_project(id));
CREATE POLICY projects_create ON projects FOR INSERT TO authenticated WITH CHECK (is_project_admin());
CREATE POLICY projects_update ON projects FOR UPDATE TO authenticated USING (can_manage_project(id)) WITH CHECK (can_manage_project(id));

CREATE POLICY scholars_read ON scholars FOR SELECT TO authenticated USING (can_access_project(project_id));
CREATE POLICY scholars_write ON scholars FOR ALL TO authenticated USING (can_manage_project(project_id)) WITH CHECK (can_manage_project(project_id));

CREATE POLICY documents_read ON documents FOR SELECT TO authenticated USING (can_access_project(project_id));
CREATE POLICY documents_write ON documents FOR ALL TO authenticated USING (can_manage_project(project_id) OR created_by::text = (SELECT auth.user_id())) WITH CHECK (can_manage_project(project_id) OR created_by::text = (SELECT auth.user_id()));

CREATE POLICY plans_read ON work_plans FOR SELECT TO authenticated USING (can_access_project(project_id));
CREATE POLICY plans_write ON work_plans FOR ALL TO authenticated USING (can_manage_project(project_id)) WITH CHECK (can_manage_project(project_id));
CREATE POLICY items_read ON plan_items FOR SELECT TO authenticated USING (can_access_project(project_id));
CREATE POLICY items_write ON plan_items FOR ALL TO authenticated USING (can_manage_project(project_id)) WITH CHECK (can_manage_project(project_id));

CREATE POLICY executions_read ON execution_records FOR SELECT TO authenticated USING (can_access_project(project_id));
CREATE POLICY executions_create ON execution_records FOR INSERT TO authenticated WITH CHECK (
  can_manage_project(project_id) OR EXISTS (SELECT 1 FROM user_project_access a WHERE a.auth_user_id=(SELECT auth.user_id()) AND a.scholar_id=execution_records.scholar_id)
);
CREATE POLICY executions_update ON execution_records FOR UPDATE TO authenticated USING (
  can_manage_project(project_id) OR EXISTS (SELECT 1 FROM user_project_access a WHERE a.auth_user_id=(SELECT auth.user_id()) AND a.scholar_id=execution_records.scholar_id)
);

CREATE POLICY reports_read ON reports FOR SELECT TO authenticated USING (can_access_project(project_id));
CREATE POLICY reports_write ON reports FOR ALL TO authenticated USING (can_manage_project(project_id)) WITH CHECK (can_manage_project(project_id));
CREATE POLICY evidence_access ON evidence FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM execution_records e WHERE e.id=execution_id AND can_access_project(e.project_id))) WITH CHECK (EXISTS (SELECT 1 FROM execution_records e WHERE e.id=execution_id AND can_access_project(e.project_id)));
CREATE POLICY versions_access ON report_versions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM reports r WHERE r.id=report_id AND can_access_project(r.project_id))) WITH CHECK (EXISTS (SELECT 1 FROM reports r WHERE r.id=report_id AND can_manage_project(r.project_id)));
CREATE POLICY validations_access ON validations FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM reports r WHERE r.id=report_id AND can_access_project(r.project_id))) WITH CHECK (EXISTS (SELECT 1 FROM reports r WHERE r.id=report_id AND can_manage_project(r.project_id)));
CREATE POLICY audit_read ON audit_logs FOR SELECT TO authenticated USING (can_manage_project(project_id));

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

CREATE OR REPLACE FUNCTION public.record_data_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target_project uuid; target_id text;
BEGIN
  IF TG_OP='DELETE' THEN
    target_id := OLD.id::text;
    IF TG_TABLE_NAME='projects' THEN target_project := OLD.id; ELSE target_project := OLD.project_id; END IF;
  ELSE
    target_id := NEW.id::text;
    IF TG_TABLE_NAME='projects' THEN target_project := NEW.id; ELSE target_project := NEW.project_id; END IF;
  END IF;
  INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata)
  VALUES(auth.user_id(),target_project,lower(TG_OP),TG_TABLE_NAME,target_id,'{}');
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER projects_audit AFTER INSERT OR UPDATE OR DELETE ON projects FOR EACH ROW EXECUTE FUNCTION record_data_change();
CREATE TRIGGER scholars_audit AFTER INSERT OR UPDATE OR DELETE ON scholars FOR EACH ROW EXECUTE FUNCTION record_data_change();
CREATE TRIGGER executions_audit AFTER INSERT OR UPDATE OR DELETE ON execution_records FOR EACH ROW EXECUTE FUNCTION record_data_change();

-- Bootstrap once from the Neon SQL Editor after the first Neon Auth signup:
-- INSERT INTO user_project_access(auth_user_id, project_id, role)
-- VALUES ('<neon-auth-user-id>', '<project-id>', 'admin');
