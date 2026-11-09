import { z } from 'zod';
import { requireProject } from '@/lib/authorize';
import { emailSettings, emailSettingsInput, saveEmailSettings } from '@/lib/fapto-email';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';

// Message model and recipients of the e-mail to the FAPTO analyst (coordination only).
export async function GET(request: Request) {
  try {
    const projectId = z.string().uuid().parse(new URL(request.url).searchParams.get('projectId'));
    await requireProject(projectId, true);
    return Response.json(await emailSettings(projectId), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    const input = emailSettingsInput.parse(await request.json());
    const { user } = await requireProject(input.projectId, true);
    await saveEmailSettings(input, user.id);
    return Response.json(await emailSettings(input.projectId));
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? 'Confira os campos informados.' }, { status: 400 });
    return travelError(error);
  }
}
