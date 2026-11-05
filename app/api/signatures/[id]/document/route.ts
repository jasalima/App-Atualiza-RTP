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
    const writable = sql`EXISTS(SELECT 1 FROM signature_requests WHERE id=${id}::uuid AND status='pending') AND NOT EXISTS(SELECT 1 FROM signature_signers WHERE request_id=${id}::uuid AND status='signed')`;
    if (r.source_kind === 'travel') {
      const [existing] = await sql`SELECT status FROM travel_reports WHERE id=${sourceId}::uuid AND project_id=${projectId}::uuid AND deleted_at IS NULL`;
      if (!existing) throw Object.assign(new Error('Relatório de viagem não encontrado.'), { status: 404 });
      const parsed = travelReportUpdate.safeParse({ ...body, status: existing.status });
      if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || 'Confira os campos informados.' }, { status: 400 });
      const v = parsed.data, entries = v.entries.filter((e) => e.date || e.activity.trim());
      const [, changed] = await sql.transaction([
        sql`SELECT id FROM signature_requests WHERE id=${id}::uuid FOR UPDATE`,
        sql`UPDATE travel_reports SET origin=${v.origin},destination=${v.destination},departure_date=${v.departureDate}::date,return_date=${v.returnDate}::date,
        payment_date=${v.paymentDate}::date,objective=${v.objective},entries=${JSON.stringify(entries)}::jsonb,updated_at=now()
        WHERE id=${sourceId}::uuid AND project_id=${projectId}::uuid AND ${writable} RETURNING *,(SELECT full_name FROM scholars WHERE id=scholar_id) AS full_name`
      ]) as unknown as Array<Array<Record<string, unknown>>>;
      const row = changed[0];
      if (!row) return Response.json({ error: 'A solicitação mudou ou já recebeu assinatura. Atualize a página.' }, { status: 409 });
      await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${access.user.id},${projectId}::uuid,'update_via_signature','travel_report',${sourceId},jsonb_build_object('request',${id}::text))`;
      return Response.json(travelReportRow(row));
    }
    const sections = rtpSections.parse(body.sections);
    const [report] = await sql`SELECT r.current_version,rv.content FROM reports r JOIN report_versions rv ON rv.report_id=r.id AND rv.version=r.current_version WHERE r.id=${sourceId}::uuid AND r.project_id=${projectId}::uuid AND r.deleted_at IS NULL`;
    if (!report) throw Object.assign(new Error('Relatório não encontrado.'), { status: 404 });
    const content: ReportContent = { ...(report.content as ReportContent), sections }, next = Number(report.current_version) + 1;
    const [, inserted] = await sql.transaction([
      sql`SELECT id FROM signature_requests WHERE id=${id}::uuid FOR UPDATE`,
      sql`INSERT INTO report_versions(report_id,version,content,change_summary,created_by) SELECT ${sourceId}::uuid,${next},${JSON.stringify(content)}::jsonb,${'Ajuste feito pelo signatário antes de assinar'},${access.user.id}
        WHERE ${writable} AND EXISTS(SELECT 1 FROM reports WHERE id=${sourceId}::uuid AND current_version=${Number(report.current_version)}) RETURNING version`,
      sql`UPDATE reports SET current_version=${next},status='draft',approved_by=NULL,approved_at=NULL WHERE id=${sourceId}::uuid AND current_version=${Number(report.current_version)} AND ${writable}`,
      sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) SELECT ${access.user.id},${projectId}::uuid,'revise_via_signature','report',${sourceId},jsonb_build_object('version',${next}::int,'request',${id}::text) WHERE ${writable}`
    ]) as unknown as Array<Array<{ version: number }>>;
    if (!inserted.length) return Response.json({ error: 'O documento mudou ou já recebeu assinatura. Atualize a página antes de editar.' }, { status: 409 });
    return Response.json({ version: next, content });
  } catch (error) { return travelError(error); }
}
