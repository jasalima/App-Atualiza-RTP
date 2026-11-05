import { verifyMinute } from '@/lib/minutes-core';
import { rateLimit } from '@/lib/rate-limit';
import { travelError } from '@/lib/travel';
export const runtime = 'nodejs';

// Public page behind the QR Code. Only what is printed on the ata is shown:
// no IP, e-mail, CPF, tokens or internal identifiers.
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    await rateLimit(request, 'verify-document', 30);
    const result = await verifyMinute((await params).code);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  } catch (error) { return travelError(error); }
}
