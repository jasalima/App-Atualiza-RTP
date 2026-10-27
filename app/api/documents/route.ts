import { z } from 'zod';
import { requireProject } from '../../../lib/authorize';
import { sql } from '../../../lib/db';
import { assertAcceptedFile, documentRegistration, documentRow, listDocuments, loadDocument } from '../../../lib/documents';
import { headPrivateObject } from '../../../lib/storage';
import { sameOrigin, travelError } from '../../../lib/travel';

export async function GET(request: Request) {
  try {
    const projectId = z.string().uuid().parse(new URL(request.url).searchParams.get('projectId'));
    const { documents } = await listDocuments(projectId);
    return Response.json(documents, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}

// Registers a file the browser already sent to the private bucket through a
// signed URL. Nothing is trusted blindly: the key must belong to this user and
// project, and the stored object must exist with the declared size.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = documentRegistration.parse(await request.json());
    const session = await requireProject(body.projectId);
    if (!body.key.startsWith(`${body.projectId}/${session.user.id}/`)) throw Object.assign(new Error('Arquivo enviado fora da área deste usuário e projeto.'), { status: 403 });
    assertAcceptedFile(body.originalName, body.size);
    const stored = await headPrivateObject(body.key);
    if (!stored || stored.size !== body.size) throw Object.assign(new Error('O arquivo não chegou completo ao armazenamento. Envie novamente.'), { status: 409 });
    let scholarId = body.scholarId;
    if (session.role === 'scholar') {
      if (!session.scholarId) throw Object.assign(new Error('Sua conta não está vinculada a um bolsista.'), { status: 403 });
      scholarId = session.scholarId;
    }
    if (scholarId && !(await sql`SELECT 1 FROM scholars WHERE id=${scholarId}::uuid AND project_id=${body.projectId}::uuid AND deleted_at IS NULL`).length)
      throw Object.assign(new Error('Membro não pertence a este projeto.'), { status: 404 });
    let version = 1;
    if (body.replacesId) {
      const { row } = await loadDocument(body.projectId, body.replacesId, true);
      if ((await sql`SELECT 1 FROM documents WHERE replaces_id=${body.replacesId}::uuid AND deleted_at IS NULL`).length) throw Object.assign(new Error('Este documento já tem uma versão mais recente.'), { status: 409 });
      version = Number(row.version ?? 1) + 1;
    }
    const [row] = await sql`INSERT INTO documents(project_id,scholar_id,kind,category,title,description,original_name,mime_type,size_bytes,storage_key,sha256,extraction_status,created_by,version,replaces_id,valid_until)
      VALUES(${body.projectId}::uuid,${scholarId}::uuid,'project_document',${body.category},${body.title},${body.description},${body.originalName},${body.mimeType},${body.size},${body.key},${body.sha256},'not_applicable',${session.user.id},${version},${body.replacesId}::uuid,${body.validUntil}::date)
      RETURNING *,(SELECT full_name FROM scholars WHERE id=scholar_id) AS scholar_name`;
    await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${session.user.id},${body.projectId}::uuid,${body.replacesId ? 'new_version' : 'upload'},'document',${String(row.id)},jsonb_build_object('name',${body.originalName}::text,'sha256',${body.sha256}::text,'version',${version}::int))`;
    return Response.json(documentRow(row), { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return Response.json({ error: 'Este arquivo já foi registrado.' }, { status: 409 });
    return travelError(error);
  }
}
