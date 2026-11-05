import { finalizeMinute } from '@/lib/minutes';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';

// Freezes the ata: version, SHA-256 of the content and public verification code.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { sameOrigin(request); return Response.json(await finalizeMinute((await params).id)); }
  catch (error) { return travelError(error); }
}
