import { z } from 'zod';
import { loadTravelReport, travelError, travelFile, travelFill } from '@/lib/travel';
export const runtime = 'nodejs';

// Formulário 26 with the report's data filled in.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params, query = new URL(request.url).searchParams;
    const projectId = z.string().uuid().parse(query.get('projectId')), format = z.enum(['pdf', 'docx']).parse(query.get('format'));
    const { beneficiary, report } = await loadTravelReport(projectId, id);
    const file = await travelFile(beneficiary, format, travelFill(report));
    return new Response(new Uint8Array(file.buffer), { headers: { 'Content-Type': file.mime, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
