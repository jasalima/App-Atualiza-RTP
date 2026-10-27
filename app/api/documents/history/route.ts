import { z } from 'zod';
import { requireProject } from '../../../../lib/authorize';
import { sql } from '../../../../lib/db';
import { travelError } from '../../../../lib/travel';
export async function GET(request: Request) {
  try {
    const projectId = z.string().uuid().parse(new URL(request.url).searchParams.get('projectId'));
    const { user } = await requireProject(projectId);
    const rows = await sql`SELECT id,file_name,source_kind,format,source_version,
      CASE WHEN status='sending' AND created_at<now()-interval '2 minutes' THEN 'uncertain' ELSE status END AS status,
      '•••• '||right(recipient_phone,4) AS recipient,created_at FROM document_deliveries
      WHERE project_id=${projectId}::uuid AND auth_user_id=${user.id} ORDER BY created_at DESC LIMIT 50`;
    return Response.json(rows, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
