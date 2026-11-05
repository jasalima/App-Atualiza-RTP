import { z } from 'zod';
import { requireModule } from '@/lib/modules';
import { sender } from '@/lib/document-source';
import { createMinute, listMinutes } from '@/lib/minutes';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';

// Atas de reunião of a project.
export async function GET(request: Request) {
  try {
    const projectId = z.string().uuid().parse(new URL(request.url).searchParams.get('projectId'));
    return Response.json(await listMinutes(projectId), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}

// "Nova ata": a numbered draft, drafted by whoever creates it.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(await request.json());
    const session = await requireModule(projectId, 'minutes');
    // Full name from the member record (by link or e-mail), as printed in the closing paragraph.
    const drafter = (await sender(session, projectId)).name;
    return Response.json(await createMinute(projectId, session.user.id, drafter), { status: 201 });
  } catch (error) { return travelError(error); }
}
