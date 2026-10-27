import { z } from 'zod';
import { sql } from '../../../../lib/db';
import { documentMetadata, documentRow, documentVersions, loadDocument } from '../../../../lib/documents';
import { sameOrigin, travelError } from '../../../../lib/travel';
type Params = { params: Promise<{ id: string }> };
const projectOf = (request: Request) => z.string().uuid().parse(new URL(request.url).searchParams.get('projectId'));
const mask = (phone: string) => phone.length > 4 ? `${'•'.repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}` : phone;

// Details: every version, WhatsApp sends and the audit trail of the document.
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params, projectId = projectOf(request);
    const { document } = await loadDocument(projectId, id);
    const versions = await documentVersions(id), ids = versions.map((v) => v.id);
    const [deliveries, audit] = await Promise.all([
      sql`SELECT status,format,recipient_phone,created_at,source_id FROM document_deliveries WHERE project_id=${projectId}::uuid AND source_kind='document' AND source_id=ANY(${ids}::uuid[]) ORDER BY created_at DESC LIMIT 30`,
      sql`SELECT a.action,a.created_at,a.metadata,coalesce(u.name,u.email,'Sistema') AS who FROM audit_logs a LEFT JOIN neon_auth."user" u ON u.id::text=a.user_id
        WHERE a.project_id=${projectId}::uuid AND a.entity_type='document' AND a.entity_id=ANY(${ids}::text[]) ORDER BY a.created_at DESC LIMIT 40`
    ]);
    return Response.json({ document, versions, deliveries: deliveries.map((d) => ({ status: d.status, format: d.format, recipient: mask(String(d.recipient_phone)), createdAt: d.created_at })), audit },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    sameOrigin(request);
    const { id } = await params, projectId = projectOf(request);
    const body = documentMetadata.parse(await request.json());
    const { session, row } = await loadDocument(projectId, id, true);
    const scholarId = session.role === 'scholar' ? row.scholar_id : body.scholarId;
    if (scholarId && !(await sql`SELECT 1 FROM scholars WHERE id=${scholarId}::uuid AND project_id=${projectId}::uuid AND deleted_at IS NULL`).length)
      throw Object.assign(new Error('Membro não pertence a este projeto.'), { status: 404 });
    const [updated] = await sql`UPDATE documents SET title=${body.title},category=${body.category},description=${body.description},scholar_id=${scholarId}::uuid,valid_until=${body.validUntil}::date,updated_at=now()
      WHERE id=${id}::uuid AND project_id=${projectId}::uuid RETURNING *,(SELECT full_name FROM scholars WHERE id=scholar_id) AS scholar_name`;
    await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${session.user.id},${projectId}::uuid,'edit','document',${id},jsonb_build_object('title',${body.title}::text,'category',${body.category}::text))`;
    return Response.json(documentRow(updated));
  } catch (error) { return travelError(error); }
}

// Logical deletion of the whole document (every version), with the reason audited.
export async function DELETE(request: Request, { params }: Params) {
  try {
    sameOrigin(request);
    const { id } = await params, projectId = projectOf(request);
    const { reason } = z.object({ reason: z.string().trim().min(5, 'Informe o motivo da exclusão.') }).parse(await request.json().catch(() => ({})));
    const { session, row } = await loadDocument(projectId, id, true);
    if (row.kind === 'individual_work_plan') throw Object.assign(new Error('Planos de Trabalho são substituídos importando uma nova versão em Planos de Trabalho.'), { status: 409 });
    const ids = (await documentVersions(id)).map((v) => v.id);
    await sql.transaction([
      sql`UPDATE documents SET deleted_at=now(),deleted_by=${session.user.id},delete_reason=${reason} WHERE id=ANY(${ids}::uuid[]) AND project_id=${projectId}::uuid AND deleted_at IS NULL`,
      sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${session.user.id},${projectId}::uuid,'delete','document',${id},jsonb_build_object('reason',${reason}::text,'versions',${ids.length}::int))`
    ]);
    return Response.json({ deleted: true, versions: ids.length });
  } catch (error) { return travelError(error); }
}

