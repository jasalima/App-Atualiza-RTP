import { z } from 'zod';
import { changeStatus } from '@/lib/minutes';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const body = z.object({ action: z.enum(['archive', 'unarchive', 'cancel', 'delete']), reason: z.string().trim().max(1000).default('') }).parse(await request.json());
    await changeStatus((await params).id, body.action, body.reason);
    return Response.json({ done: true });
  } catch (error) { return travelError(error); }
}
