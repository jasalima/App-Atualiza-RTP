import { requireUser, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';

export async function GET(){
  try {
    const {user,mustChangePassword}=await requireUser();
    const [access]=await sql`
      SELECT a.role,a.project_id,a.scholar_id
      FROM user_project_access a
      WHERE a.auth_user_id=${user.id}
      ORDER BY CASE a.role WHEN 'admin' THEN 0 WHEN 'coordinator' THEN 1 ELSE 2 END
      LIMIT 1`;
    return Response.json({
      id:user.id,
      name:user.name||user.email,
      email:user.email,
      role:access?.role??null,
      projectId:access?.project_id??null,
      scholarId:access?.scholar_id??null,
      mustChangePassword,
    },{headers:{'Cache-Control':'no-store'}});
  } catch(error) { return routeError(error); }
}
