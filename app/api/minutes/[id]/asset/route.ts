import { minuteAccess } from '@/lib/minutes';
import { minuteFolder } from '@/lib/minutes-core';
import { signedDownloadUrl } from '@/lib/storage';
import { travelError } from '@/lib/travel';
export const runtime = 'nodejs';

// Images and annexes of an ata, for project members: a short-lived link to the private bucket.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params, access = await minuteAccess(id);
    const key = new URL(request.url).searchParams.get('key') ?? '';
    if (!key.startsWith(minuteFolder(String(access.row.project_id), id)) || key.includes('..')) throw Object.assign(new Error('Arquivo não pertence a esta ata.'), { status: 404 });
    const name = new URL(request.url).searchParams.get('name') ?? undefined;
    return Response.redirect(await signedDownloadUrl(key, { filename: name, inline: true, contentType: key.endsWith('.pdf') ? 'application/pdf' : undefined }), 302);
  } catch (error) { return travelError(error); }
}
