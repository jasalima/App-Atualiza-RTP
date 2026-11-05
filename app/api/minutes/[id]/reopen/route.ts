import { z } from 'zod';
import { reopenMinute } from '@/lib/minutes';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';

// Back to editing: the issued version becomes "substituída" (signatures, if any, are cancelled with a reason).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { reason } = z.object({ reason: z.string().max(1000).default('') }).parse(await request.json().catch(() => ({})));
    await reopenMinute((await params).id, reason);
    return Response.json({ reopened: true });
  } catch (error) { return travelError(error); }
}
