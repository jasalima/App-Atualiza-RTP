import { z } from 'zod';
import { documentSource, requestAccess, signedFile } from '@/lib/signatures';
import { travelError } from '@/lib/travel';
export const runtime = 'nodejs';

// The document of a signing link as a file: PDF opens in the browser, DOCX downloads.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params, format = z.enum(['pdf', 'docx']).parse(new URL(request.url).searchParams.get('format') ?? 'pdf');
    const access = await requestAccess(id), r = access.request;
    const source = await documentSource(String(r.project_id), r.source_kind as 'travel' | 'rtp', String(r.source_id));
    const file = await signedFile(source, format);
    return new Response(new Uint8Array(file.buffer), { headers: { 'Content-Type': file.mime, 'Content-Disposition': `${format === 'pdf' ? 'inline' : 'attachment'}; filename="${file.filename}"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
