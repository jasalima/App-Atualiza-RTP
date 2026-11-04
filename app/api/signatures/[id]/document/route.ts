import { z } from 'zod';
import { sql } from '@/lib/db';
import { requestAccess } from '@/lib/signatures';
import { sameOrigin, travelError, travelReportRow, travelReportUpdate } from '@/lib/travel';
import type { ReportContent } from '@/server/types';
export const runtime = 'nodejs';

const rtpSections = z.object({ results: z.string().max(40000), comparison: z.string().max(40000), additional: z.string().max(40000) });
// Edits made from the signing link, before the first signature (afterwards the content is fixed).
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { id } = await params, access = await requestAccess(id), r = access.request;
    if (!access.canEdit) throw Object.assign(new Error(access.anySigned ? 'O documento já recebeu assinatura e não pode mais ser alterado.' : 'Somente quem assina agora pode alterar o documento.'), { status: 409 });
    const projectId = String(r.project_id), sourceId = String(r.source_id), body = await request.json();
    if (r.source_kind === 'travel') {
      const [existing] = await sql`SELECT status FROM travel_reports WHERE id=${sourceId}::uuid AND project_id=${projectId}::uuid AND deleted_at IS NULL`;
      if (!existing) throw Object.assign(new Error('Relatório de viagem não encontrado.'), { status: 404 });
      const parsed = travelReportUpdate.safeParse({ ...body, status: existing.status });
      if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || 'Confira os campos informados.' }, { status: 400 });
      const v = parsed.data, entries = v.entries.filter((e) => e.date || e.activity.trim());
      const [row] = await sql`UPDATE travel_reports SET origin=${v.origin},destination=${v.destination},departure_date=${v.departureDate}::date,return_date=${v.returnDate}::date,
        payment_date=${v.paymentDate}::date,objective=${v.objective},entries=${JSON.stringify(entries)}::jsonb,updated_at=now()
        WHERE id=${sourceId}::uuid AND project_id=${projectId}::uuid RETURNING *,(SELECT full_name FROM scholars WHERE id=scholar_id) AS full_name`;
      await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${access.user.id},${projectId}::uuid,'update_via_signature','travel_report',${sourceId},jsonb_build_object('request',${id}::text))`;
      return Response.json(travelReportRow(row));
    }
    const sections = rtpSections.parse(body.sections);
    const [report] = await sql`SELECT r.current_version,rv.content FROM reports r JOIN report_versions rv ON rv.report_id=r.id AND rv.version=r.current_version WHERE r.id=${sourceId}::uuid AND r.project_id=${projectId}::uuid AND r.deleted_at IS NULL`;
    if (!report) throw Object.assign(new Error('Relatório não encontrado.'), { status: 404 });
    const content: ReportContent = { ...(report.content as ReportContent), sections }, next = Number(report.current_version) + 1;
    await sql.transaction([
      sql`INSERT INTO report_versions(report_id,version,content,change_summary,created_by) VALUES(${sourceId}::uuid,${next},${JSON.stringify(content)}::jsonb,${'Ajuste feito pelo signatário antes de assinar'},${access.user.id})`,
      sql`UPDATE reports SET current_version=${next} WHERE id=${sourceId}::uuid`,
      sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${access.user.id},${projectId}::uuid,'revise_via_signature','report',${sourceId},jsonb_build_object('version',${next}::int,'request',${id}::text))`
    ]);
    return Response.json({ version: next, content });
  } catch (error) { return travelError(error); }
}
