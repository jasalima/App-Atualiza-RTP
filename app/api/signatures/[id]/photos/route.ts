import { requestAccess } from '@/lib/signatures';
import { sameOrigin, travelError } from '@/lib/travel';
import { photoAction, photoOperation } from '@/lib/travel-photos';
export const runtime = 'nodejs';

// Photos inserted from the signing link, under the same rule as the other edits.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { id } = await params, input = photoAction.parse(await request.json());
    const access = await requestAccess(id);
    if (access.request.source_kind !== 'travel') throw Object.assign(new Error('Fotos fazem parte apenas do relatório de viagem.'), { status: 400 });
    if (!access.canEdit) throw Object.assign(new Error(access.anySigned ? 'O documento já recebeu assinatura e não pode mais ser alterado.' : 'Somente quem assina agora pode alterar o documento.'), { status: 409 });
    return Response.json(await photoOperation(String(access.request.project_id), String(access.request.source_id), access.user.id, input), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
