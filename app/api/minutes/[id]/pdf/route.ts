import { sql } from '@/lib/db';
import { draftOf, minuteAccess } from '@/lib/minutes';
import { contentImageKeys, loadImages, minuteFolder, officialPdf } from '@/lib/minutes-core';
import { freezeContent, minuteNumber } from '@/lib/minutes-model';
import { minutesPdf } from '@/server/services/minutes-pdf';
import { travelError } from '@/lib/travel';
export const runtime = 'nodejs';

// The ata as PDF: the official file of the issued version (with the signatures collected so far),
// or, while it is being written, a preview marked "MINUTA — NÃO FINALIZADA".
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params, access = await minuteAccess(id), row = access.row;
    const download = new URL(request.url).searchParams.get('download') === '1';
    const [version] = await sql`SELECT id FROM meeting_minute_versions WHERE minute_id=${id}::uuid ORDER BY (status='active') DESC,version DESC LIMIT 1`;
    let file: { buffer: Buffer; filename: string };
    if (version && !['draft', 'editing'].includes(String(row.status))) file = await officialPdf(String(version.id));
    else {
      const number = minuteNumber(Number(row.seq), Number(row.year)), content = freezeContent(await draftOf(row), { number, projectTitle: String(row.project_title) });
      const images = await loadImages(contentImageKeys(content, minuteFolder(String(row.project_id), id)));
      file = { buffer: await minutesPdf(content, { draft: true, signatures: [], totalSigners: 0, images }), filename: `${number.replace(/[^\w]+/g, '-')}-minuta.pdf` };
    }
    return new Response(new Uint8Array(file.buffer), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${file.filename}"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
