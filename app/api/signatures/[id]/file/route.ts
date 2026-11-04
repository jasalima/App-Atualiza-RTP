import { z } from 'zod';
import { documentSource, fullTravelFill, requestAccess, signatureManifest } from '@/lib/signatures';
import { travelError, travelFile } from '@/lib/travel';
import { toDocx, toPdf } from '@/server/services/export';
export const runtime = 'nodejs';

// The document of a signing link as a file: PDF opens in the browser, DOCX downloads.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params, format = z.enum(['pdf', 'docx']).parse(new URL(request.url).searchParams.get('format') ?? 'pdf');
    const access = await requestAccess(id), r = access.request;
    const source = await documentSource(String(r.project_id), r.source_kind as 'travel' | 'rtp', String(r.source_id));
    let file: { buffer: Buffer; mime: string; filename: string };
    if (source.travel) file = await travelFile(source.travel.beneficiary, format, await fullTravelFill(source.travel.report));
    else {
      const signatures = await signatureManifest('rtp', source.sourceId);
      file = { buffer: await (format === 'pdf' ? toPdf(source.rtp!.content, signatures) : toDocx(source.rtp!.content, signatures)), mime: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: `RTP-${source.rtp!.number.replace(/[^a-z0-9-]/gi, '_')}.${format}` };
    }
    return new Response(new Uint8Array(file.buffer), { headers: { 'Content-Type': file.mime, 'Content-Disposition': `${format === 'pdf' ? 'inline' : 'attachment'}; filename="${file.filename}"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
