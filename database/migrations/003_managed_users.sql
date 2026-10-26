CREATE TABLE managed_users (
  auth_user_id text PRIMARY KEY,
  name text NOT NULL,
  email citext NOT NULL UNIQUE,
  must_change_password boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER managed_users_touch BEFORE UPDATE ON managed_users
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE managed_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY managed_users_read_self ON managed_users FOR SELECT TO authenticated
  USING (auth_user_id = (SELECT auth.user_id()) AND revoked_at IS NULL);

GRANT SELECT ON managed_users TO authenticated;

-- A revoked account or one still using its temporary password cannot reach
-- institutional data, even by calling the Data API directly.
CREATE OR REPLACE FUNCTION public.can_access_project(target_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_project_access a
    WHERE a.auth_user_id = (SELECT auth.user_id())
      AND (a.project_id = target_project OR a.role = 'admin')
      AND NOT EXISTS (
        SELECT 1 FROM managed_users u
        WHERE u.auth_user_id = a.auth_user_id
          AND (u.revoked_at IS NOT NULL OR u.must_change_password)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_project(target_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_project_access a
    WHERE a.auth_user_id = (SELECT auth.user_id())
      AND (a.role = 'admin' OR (a.project_id = target_project AND a.role = 'coordinator'))
      AND NOT EXISTS (
        SELECT 1 FROM managed_users u
        WHERE u.auth_user_id = a.auth_user_id
          AND (u.revoked_at IS NOT NULL OR u.must_change_password)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_project_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_project_access a
    WHERE a.auth_user_id = (SELECT auth.user_id())
      AND a.role = 'admin'
      AND NOT EXISTS (
        SELECT 1 FROM managed_users u
        WHERE u.auth_user_id = a.auth_user_id
          AND (u.revoked_at IS NOT NULL OR u.must_change_password)
      )
  );
$$;

DROP POLICY access_own_memberships ON user_project_access;
CREATE POLICY access_own_memberships ON user_project_access FOR SELECT TO authenticated
  USING (
    auth_user_id = (SELECT auth.user_id())
    AND NOT EXISTS (
      SELECT 1 FROM managed_users u
      WHERE u.auth_user_id = user_project_access.auth_user_id
        AND (u.revoked_at IS NOT NULL OR u.must_change_password)
    )
  );
