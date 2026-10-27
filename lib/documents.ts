import { z } from 'zod';
import { requireProject } from './authorize';
import { sql } from './db';

// Project document management: categories, accepted files and the access rule
// (coordination sees every document; a scholar sees their own and those they uploaded).

export const DOCUMENT_CATEGORIES = ['work_plan', 'evidence', 'contract', 'minutes', 'official_letter', 'invoice', 'certificate', 'technical', 'report', 'other'] as const;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ACCEPTED = /\.(pdf|docx?|xlsx?|odt|ods|odp|pptx?|csv|txt|rtf|png|jpe?g|webp|heic|zip)$/i;

/** Rejects names and types the library does not store (executables, scripts, unknown formats). */
export function assertAcceptedFile(name: string, size: number) {
  if (!ACCEPTED.test(name)) throw Object.assign(new Error('Tipo de arquivo não aceito. Envie PDF, documentos do Office/LibreOffice, planilhas, imagens, CSV, TXT ou ZIP.'), { status: 415 });
  if (size <= 0) throw Object.assign(new Error('O arquivo está vazio.'), { status: 400 });
  if (size > MAX_UPLOAD_BYTES) throw Object.assign(new Error('O arquivo passa de 50 MB.'), { status: 413 });
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const documentMetadata = z.object({
  title: z.string().trim().min(2, 'Informe um título.').max(200),
  category: z.enum(DOCUMENT_CATEGORIES),
  description: z.string().trim().max(2000).default(''),
  scholarId: z.string().uuid().nullable().default(null),
  validUntil: day.nullable().default(null)
});
export const documentRegistration = documentMetadata.extend({
  projectId: z.string().uuid(),
  key: z.string().min(10).max(400),
  originalName: z.string().trim().min(1).max(240),
  mimeType: z.string().max(160).default('application/octet-stream'),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  replacesId: z.string().uuid().nullable().default(null)
});

const iso = (d: unknown) => d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d ? String(d).slice(0, 10) : null;
export const documentRow = (r: Record<string, unknown>) => ({
  id: String(r.id), projectId: String(r.project_id), scholarId: r.scholar_id ? String(r.scholar_id) : null, scholarName: r.scholar_name ? String(r.scholar_name) : null,
  title: String(r.title || r.original_name), originalName: String(r.original_name), category: String(r.category), kind: String(r.kind),
  description: String(r.description ?? ''), mimeType: String(r.mime_type), size: Number(r.size_bytes), sha256: String(r.sha256),
  version: Number(r.version ?? 1), versions: Number(r.versions ?? 1), replacesId: r.replaces_id ? String(r.replaces_id) : null,
  validUntil: iso(r.valid_until), createdBy: r.created_by ? String(r.created_by) : null, createdAt: String(r.created_at), updatedAt: String(r.updated_at ?? r.created_at)
});

/** Live, latest version of each document chain the session may see. */
export async function listDocuments(projectId: string) {
  const session = await requireProject(projectId);
  const rows = await sql`SELECT d.*,s.full_name AS scholar_name,
      (WITH RECURSIVE chain AS (SELECT id,replaces_id FROM documents WHERE id=d.id UNION ALL SELECT p.id,p.replaces_id FROM documents p JOIN chain c ON p.id=c.replaces_id) SELECT count(*) FROM chain) AS versions
    FROM documents d JOIN projects p ON p.id=d.project_id AND p.deleted_at IS NULL LEFT JOIN scholars s ON s.id=d.scholar_id
    WHERE d.project_id=${projectId}::uuid AND d.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM documents n WHERE n.replaces_id=d.id AND n.deleted_at IS NULL)
      AND (${session.role !== 'scholar'} OR d.scholar_id=${session.scholarId}::uuid OR d.created_by=${session.user.id})
    ORDER BY d.created_at DESC`;
  return { session, documents: rows.map(documentRow) };
}

/** One document the session may see; `manage` also requires the right to change it. */
export async function loadDocument(projectId: string, id: string, manage = false) {
  const session = await requireProject(projectId);
  const [row] = await sql`SELECT d.*,s.full_name AS scholar_name FROM documents d LEFT JOIN scholars s ON s.id=d.scholar_id
    WHERE d.id=${id}::uuid AND d.project_id=${projectId}::uuid AND d.deleted_at IS NULL`;
  if (!row) throw Object.assign(new Error('Documento não encontrado neste projeto.'), { status: 404 });
  const own = row.created_by === session.user.id || (session.scholarId && row.scholar_id === session.scholarId);
  if (session.role === 'scholar' && !own) throw Object.assign(new Error('Você não tem acesso a este documento.'), { status: 403 });
  if (manage && session.role === 'scholar' && row.created_by !== session.user.id) throw Object.assign(new Error('Só quem enviou o documento ou a coordenação pode alterá-lo.'), { status: 403 });
  return { session, row, document: documentRow(row) };
}

/** Every version of the chain the document belongs to, newest first. */
export async function documentVersions(id: string) {
  const rows = await sql`WITH RECURSIVE up AS (SELECT * FROM documents WHERE id=${id}::uuid UNION ALL SELECT p.* FROM documents p JOIN up ON p.id=up.replaces_id),
    down AS (SELECT * FROM documents WHERE id=${id}::uuid UNION ALL SELECT n.* FROM documents n JOIN down ON n.replaces_id=down.id)
    SELECT DISTINCT ON (id) * FROM (SELECT * FROM up UNION ALL SELECT * FROM down) v ORDER BY id`;
  return rows.map(documentRow).sort((a, b) => b.version - a.version);
}
