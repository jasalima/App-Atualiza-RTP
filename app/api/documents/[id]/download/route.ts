import { z } from 'zod';
import { sql } from '../../../../../lib/db';
import { loadDocument } from '../../../../../lib/documents';
import { signedDownloadUrl } from '../../../../../lib/storage';
import { travelError } from '../../../../../lib/travel';

// A five-minute link to view (inline) or download the stored file; every access is audited.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params, query = new URL(request.url).searchParams;
    const projectId = z.string().uuid().parse(query.get('projectId')), mode = z.enum(['view', 'download']).parse(query.get('mode') ?? 'download');
    const { session, row } = await loadDocument(projectId, id);
    if (!String(row.storage_key).startsWith(`${projectId}/`)) throw Object.assign(new Error('Documento não encontrado neste projeto.'), { status: 404 });
    const url = await signedDownloadUrl(String(row.storage_key), { filename: String(row.original_name), inline: mode === 'view', contentType: String(row.mime_type) });
    await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id) VALUES(${session.user.id},${projectId}::uuid,${mode},'document',${id})`;
    return Response.json({ url, expiresIn: 300 }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
