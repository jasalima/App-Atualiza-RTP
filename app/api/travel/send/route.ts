import { z } from 'zod';
import { loadTravel, sameOrigin, travelError, travelQuery } from '../../../../lib/travel';
import { POST as sendDocument } from '../../documents/send/route';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = travelQuery.extend({ requestId: z.string().uuid() }).parse(await request.json());
    const { beneficiary } = await loadTravel(body.projectId, body.scholarId);
    const headers = new Headers(request.headers); headers.delete('Content-Length');
    return sendDocument(new Request(request.url, { method: 'POST', headers, body: JSON.stringify({ projectId: body.projectId, sourceId: body.scholarId, kind: 'travel', format: body.format, requestId: body.requestId, recipientPhone: beneficiary.phone }) }));
  } catch (error) { return travelError(error); }
}
