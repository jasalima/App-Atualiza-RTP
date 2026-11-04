import { z } from 'zod';
import { assertUnsigned } from '@/lib/signatures';
import { loadTravelReport, sameOrigin, travelError } from '@/lib/travel';
import { photoAction, photoOperation, withUrls } from '@/lib/travel-photos';
export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };
const projectOf = (request: Request) => z.string().uuid().parse(new URL(request.url).searchParams.get('projectId'));

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params, { report } = await loadTravelReport(projectOf(request), id);
    return Response.json({ photos: await withUrls(report.photos) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}

// Team members edit photos like the other fields: managers, or the member while the report is open.
export async function POST(request: Request, { params }: Params) {
  try {
    sameOrigin(request);
    const { id } = await params, projectId = projectOf(request);
    const input = photoAction.parse(await request.json());
    const { session } = await loadTravelReport(projectId, id, true);
    await assertUnsigned('travel', id);
    return Response.json(await photoOperation(projectId, id, session.user.id, input), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
