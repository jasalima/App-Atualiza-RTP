import { z } from 'zod';
import { minuteAccess } from '@/lib/minutes';
import { minuteFolder } from '@/lib/minutes-core';
import { signedUploadUrl } from '@/lib/storage';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';

const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
};
// Upload ticket for an image of the text or an annex: the file goes straight to the private bucket.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { id } = await params, access = await minuteAccess(id, true);
    if (!['draft', 'editing'].includes(String(access.row.status))) throw Object.assign(new Error('Ata finalizada: reabra a edição para anexar arquivos.'), { status: 409 });
    const body = z.object({ contentType: z.string(), size: z.number().int().positive().max(15 * 1024 * 1024, 'Arquivos de até 15 MB.') }).parse(await request.json());
    const ext = TYPES[body.contentType];
    if (!ext) throw Object.assign(new Error('Use imagens (JPG, PNG), PDF, DOCX ou XLSX.'), { status: 400 });
    const key = `${minuteFolder(String(access.row.project_id), id)}${crypto.randomUUID()}.${ext}`;
    return Response.json({ key, url: await signedUploadUrl(key, body.contentType), src: `/api/minutes/${id}/asset?key=${encodeURIComponent(key)}` });
  } catch (error) { return travelError(error); }
}
