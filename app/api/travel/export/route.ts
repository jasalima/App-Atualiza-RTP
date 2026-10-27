import { loadTravel, travelError, travelFile, travelQuery } from '@/lib/travel';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const q = travelQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    const { beneficiary } = await loadTravel(q.projectId, q.scholarId);
    const file = await travelFile(beneficiary, q.format);
    return new Response(new Uint8Array(file.buffer), { headers: { 'Content-Type': file.mime, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
