import { z } from 'zod';
import { requireProject } from '@/lib/authorize';
import { signerCandidates } from '@/lib/signatures';
import { travelError } from '@/lib/travel';

export async function GET(request: Request) {
  try {
    const projectId = z.string().uuid().parse(new URL(request.url).searchParams.get('projectId'));
    await requireProject(projectId, true);
    return Response.json(await signerCandidates(projectId), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
