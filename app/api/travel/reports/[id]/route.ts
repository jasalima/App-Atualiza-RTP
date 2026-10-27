import { z } from 'zod';
import { sql } from '@/lib/db';
import { loadTravelReport, sameOrigin, travelError, travelReportRow, travelReportUpdate } from '@/lib/travel';
export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };
const projectOf = (request: Request) => z.string().uuid().parse(new URL(request.url).searchParams.get('projectId'));

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { beneficiary, report } = await loadTravelReport(projectOf(request), id);
    return Response.json({ ...report, beneficiary }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    sameOrigin(request);
    const { id } = await params, projectId = projectOf(request);
    const parsed = travelReportUpdate.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || 'Confira os campos informados.' }, { status: 400 });
    const v = parsed.data, { session } = await loadTravelReport(projectId, id, true);
    const entries = v.entries.filter((e) => e.date || e.activity.trim());
    const [row] = await sql`UPDATE travel_reports SET origin=${v.origin},destination=${v.destination},departure_date=${v.departureDate}::date,return_date=${v.returnDate}::date,
      payment_date=${v.paymentDate}::date,objective=${v.objective},entries=${JSON.stringify(entries)}::jsonb,status=${v.status},updated_at=now()
      WHERE id=${id}::uuid AND project_id=${projectId}::uuid AND deleted_at IS NULL RETURNING *,(SELECT full_name FROM scholars WHERE id=scholar_id) AS full_name`;
    await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${session.user.id},${projectId}::uuid,${v.status === 'finalized' ? 'finalize' : 'update'},'travel_report',${id},jsonb_build_object('status',${v.status}::text))`;
    return Response.json(travelReportRow(row));
  } catch (error) { return travelError(error); }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    sameOrigin(request);
    const { id } = await params, projectId = projectOf(request);
    const { session } = await loadTravelReport(projectId, id, true);
    await sql.transaction([
      sql`UPDATE travel_reports SET deleted_at=now() WHERE id=${id}::uuid AND project_id=${projectId}::uuid`,
      sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id) VALUES(${session.user.id},${projectId}::uuid,'delete','travel_report',${id})`
    ]);
    return Response.json({ deleted: true });
  } catch (error) { return travelError(error); }
}
