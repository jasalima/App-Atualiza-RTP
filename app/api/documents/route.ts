import { z } from 'zod';
import { requireProject } from '../../../lib/authorize';
import { sql } from '../../../lib/db';
import { travelError } from '../../../lib/travel';
export async function GET(request: Request) {
  try {
    const projectId = z.string().uuid().parse(new URL(request.url).searchParams.get('projectId'));
    const session = await requireProject(projectId);
    const rows = await sql`SELECT d.id,d.project_id,d.scholar_id,d.kind,d.original_name,d.mime_type,d.size_bytes,d.created_at,s.full_name AS scholar_name
      FROM documents d JOIN projects p ON p.id=d.project_id AND p.deleted_at IS NULL LEFT JOIN scholars s ON s.id=d.scholar_id
      WHERE d.project_id=${projectId}::uuid AND (${session.role !== 'scholar'} OR d.scholar_id=${session.scholarId}::uuid OR d.created_by=${session.user.id}) ORDER BY d.created_at DESC`;
    return Response.json(rows, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
