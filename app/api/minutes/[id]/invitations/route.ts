import { after } from 'next/server';
import { minuteAccess } from '@/lib/minutes';
import { versionSignatures } from '@/lib/minutes-core';
import { renewExpiredGuestInvitations } from '@/lib/external-signatures';
import { dispatchAfterSignature } from '@/lib/signature-dispatch';
import { sql } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const id = (await params).id, access = await minuteAccess(id, true);
    await rateLimit(request, 'minute-invitations', 3);
    const [version] = await sql`SELECT id FROM meeting_minute_versions WHERE minute_id=${id}::uuid AND status='active'`;
    const current = version ? await versionSignatures(String(version.id)) : null;
    if (!current?.request || current.request.status !== 'pending') return Response.json({ error: 'Não há coleta de assinaturas pendente nesta ata.' }, { status: 409 });
    const requestId = String(current.request.id), renewed = await renewExpiredGuestInvitations(requestId);
    await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${access.session.user.id},${access.row.project_id}::uuid,'resend_invitations','signature_request',${requestId},jsonb_build_object('renewed',${renewed}::int))`;
    after(() => dispatchAfterSignature(requestId, 'created').catch(() => console.error('Falha no reenvio dos convites da ata.')));
    return Response.json({ accepted: true, renewed });
  } catch (error) { return travelError(error); }
}
