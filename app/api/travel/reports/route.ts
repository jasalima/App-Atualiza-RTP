import { z } from 'zod';
import { requireProject } from '@/lib/authorize';
import { sql } from '@/lib/db';
import { loadTravel, sameOrigin, travelError, travelReportRow } from '@/lib/travel';
export const runtime = 'nodejs';

// Filled Formulário 26 reports of the project; scholars see only their own.
export async function GET(request: Request) {
  try {
    const projectId = z.string().uuid().parse(new URL(request.url).searchParams.get('projectId'));
    const session = await requireProject(projectId);
    const rows = await sql`SELECT t.*,s.full_name,
        (SELECT r.status FROM signature_requests r WHERE r.source_kind='travel' AND r.source_id=t.id ORDER BY r.created_at DESC LIMIT 1) AS signature_status,
        (SELECT max(d.created_at) FROM email_deliveries d WHERE d.project_id=t.project_id AND d.status='sent' AND t.id = ANY(d.source_ids)) AS emailed_at
      FROM travel_reports t JOIN scholars s ON s.id=t.scholar_id
      WHERE t.project_id=${projectId}::uuid AND t.deleted_at IS NULL AND (${session.role !== 'scholar'} OR t.scholar_id=${session.scholarId}::uuid)
      ORDER BY t.updated_at DESC`;
    return Response.json(rows.map(travelReportRow), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}

// "Iniciar relatório de prestação de contas": a draft for the chosen member.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = z.object({ projectId: z.string().uuid(), scholarId: z.string().uuid() }).parse(await request.json());
    const { session } = await loadTravel(body.projectId, body.scholarId);
    const [row] = await sql`INSERT INTO travel_reports(project_id,scholar_id,created_by) VALUES(${body.projectId}::uuid,${body.scholarId}::uuid,${session.user.id})
      RETURNING *,(SELECT full_name FROM scholars WHERE id=${body.scholarId}::uuid) AS full_name`;
    await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id) VALUES(${session.user.id},${body.projectId}::uuid,'create','travel_report',${String(row.id)})`;
    return Response.json(travelReportRow(row), { status: 201 });
  } catch (error) { return travelError(error); }
}
