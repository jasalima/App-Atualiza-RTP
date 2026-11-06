import { z } from 'zod';
import { sql } from '@/lib/db';
import { documentSource, requestAccess, type SignatureKind } from '@/lib/signatures';
import { requestView, signerView } from '@/lib/signature-view';
import { sameOrigin, travelError } from '@/lib/travel';
import { withUrls } from '@/lib/travel-photos';
import { maskCpf } from '@/server/services/signature-stamp';
export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };

// Signing page: the document as it will be signed, the order of signers and what the session may do.
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const access = await requestAccess(id), r = access.request;
    const source = await documentSource(String(r.project_id), r.source_kind as SignatureKind, String(r.source_id));
    const [project] = await sql`SELECT title FROM projects WHERE id=${r.project_id}::uuid`;
    const [profile] = await sql`SELECT cpf FROM signer_identities WHERE auth_user_id=${access.user.id}`;
    // Returned by the coordination: the reason of the refusal that reopened this request for the beneficiary.
    const [back] = r.status === 'pending' && r.mode !== 'parallel' && !access.anySigned
      ? await sql`SELECT x.closed_reason,s.name,s.role_label FROM signature_requests x JOIN signature_signers s ON s.request_id=x.id AND s.status='rejected' AND s.step>1
          WHERE x.source_kind=${r.source_kind} AND x.source_id=${r.source_id}::uuid AND x.status='rejected' AND x.created_at<${r.created_at} ORDER BY x.created_at DESC LIMIT 1`
      : [];
    const document = source.minutes
      ? { kind: 'minutes' as const, number: source.minutes.content.number, subject: source.minutes.content.subject, version: source.minutes.version, publicCode: source.minutes.public_code, minuteId: source.minutes.minute_id }
      : source.travel
      ? { kind: 'travel' as const, beneficiary: source.travel.beneficiary, report: { ...source.travel.report, photos: await withUrls(source.travel.report.photos) } }
      : { kind: 'rtp' as const, number: source.rtp!.number, version: source.version, content: source.rtp!.content };
    return Response.json({
      request: requestView(r, access.signers), projectTitle: String(project?.title ?? ''), documentHash: source.hash, document,
      me: access.me ? { ...signerView(access.me), cpfOnFile: profile ? maskCpf(String(profile.cpf)) : null } : null,
      manager: access.manager, canEdit: access.canEdit, identityReady: !!profile,
      returned: back ? { by: String(back.name), role: String(back.role_label ?? ''), reason: String(back.closed_reason ?? '') } : null,
      canSign: !!profile && r.status === 'pending' && !!access.me && (r.mode === 'parallel' ? access.me.status === 'pending' : access.current?.id === access.me.id), mode: String(r.mode ?? 'sequential')
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}

// The team cancels an open request, or a completed one to change the document (signatures are discarded).
export async function DELETE(request: Request, { params }: Params) {
  try {
    sameOrigin(request);
    const { id } = await params, { reason } = z.object({ reason: z.string().trim().min(5, 'Informe o motivo do cancelamento.') }).parse(await request.json().catch(() => ({})));
    const access = await requestAccess(id);
    if (!access.manager) throw Object.assign(new Error('Somente a coordenação cancela solicitações de assinatura.'), { status: 403 });
    if (!['pending', 'completed'].includes(String(access.request.status))) throw Object.assign(new Error('Esta solicitação já foi encerrada.'), { status: 409 });
    await sql.transaction([
      sql`UPDATE signature_requests SET status='cancelled',closed_reason=${reason} WHERE id=${id}::uuid`,
      sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${access.user.id},${access.request.project_id}::uuid,'cancel_signatures','signature_request',${id},jsonb_build_object('reason',${reason}::text,'previous',${String(access.request.status)}::text))`
    ]);
    return Response.json({ cancelled: true });
  } catch (error) { return travelError(error); }
}
