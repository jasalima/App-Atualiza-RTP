import { draftInput, minuteAccess, minuteView, saveDraft } from '@/lib/minutes';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try { return Response.json(await minuteView((await params).id), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return travelError(error); }
}

// Saves the draft. Finalized atas are frozen: reopen them first.
export async function PUT(request: Request, { params }: Params) {
  try {
    sameOrigin(request);
    const { id } = await params, access = await minuteAccess(id, true);
    if (!['draft', 'editing'].includes(String(access.row.status))) throw Object.assign(new Error('Ata finalizada: reabra a edição para alterá-la.'), { status: 409 });
    const draft = draftInput.parse(await request.json());
    const number = await saveDraft(id, String(access.row.project_id), access.session.user.id, draft);
    return Response.json({ saved: true, savedAt: new Date().toISOString(), number });
  } catch (error) { return travelError(error); }
}
