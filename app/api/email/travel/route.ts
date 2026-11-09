import { z } from 'zod';
import { requireProject } from '@/lib/authorize';
import { sendInput, sendTravelToFapto } from '@/lib/fapto-email';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Signed Formulário 26 reports to the FAPTO analyst by e-mail (preview: true only renders it).
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = sendInput.parse(await request.json());
    const { user } = await requireProject(input.projectId, true);
    return Response.json(await sendTravelToFapto(input, user), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? 'Confira os campos informados.' }, { status: 400 });
    return travelError(error);
  }
}
