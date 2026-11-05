import { z } from 'zod';
import { requireProject } from '@/lib/authorize';
import { participantCandidates } from '@/lib/minutes';
import { travelError } from '@/lib/travel';
export const runtime = 'nodejs';

// Members of the project that may be marked as present (their registration is never changed).
export async function GET(request: Request) {
  try {
    const projectId = z.string().uuid().parse(new URL(request.url).searchParams.get('projectId'));
    await requireProject(projectId);
    return Response.json(await participantCandidates(projectId), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
