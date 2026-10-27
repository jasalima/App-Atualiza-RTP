import { requireUser, routeError } from '../../../lib/authorize';
import { sql } from '../../../lib/db';

// Bootstrap uses the same cookie/session as /users/me. An unavailable JWT or
// Data API must never turn an existing project into a successful empty result.
export async function GET() {
  try {
    const { user, mustChangePassword } = await requireUser();
    if (mustChangePassword) return Response.json({ error: 'Troque sua senha temporária antes de continuar.' }, { status: 428 });
    const projects = await sql`SELECT p.* FROM projects p WHERE p.deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM user_project_access a WHERE a.auth_user_id=${user.id}
        AND (a.project_id=p.id OR a.role='admin')) ORDER BY p.created_at DESC`;
    return Response.json(projects, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return routeError(error); }
}
