import { after } from 'next/server';
import { sendForSignature } from '@/lib/minutes';
import { dispatchAfterSignature } from '@/lib/signature-dispatch';
import { signLink } from '@/lib/signatures';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';

// "Encaminhar para assinatura": every selected participant receives the ata at the same time.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const result = await sendForSignature((await params).id, request);
    after(() => dispatchAfterSignature(result.requestId, 'created').catch((error) => console.error('minute dispatch', result.requestId, error)));
    return Response.json({ ...result, link: signLink(result.requestId) }, { status: 201 });
  } catch (error) { return travelError(error); }
}
