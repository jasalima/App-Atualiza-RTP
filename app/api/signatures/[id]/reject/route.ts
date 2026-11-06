import { z } from 'zod';
import { sql } from '@/lib/db';
import { requestAccess } from '@/lib/signatures';
import { dispatchAfterSignature, type Delivery } from '@/lib/signature-dispatch';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';

// The current signer refuses to sign, with a reason.
// Sequential documents (travel, RTP): when someone after the beneficiary refuses (the coordination),
// the document goes back to the beneficiary. This request closes as rejected, keeping its history, and
// an identical one opens in the name of whoever sent the first one, so the beneficiary can correct the
// content and sign again; the reason reaches the beneficiary on WhatsApp. A refusal by the first signer
// only closes the request, for the team to decide.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { id } = await params, { reason } = z.object({ reason: z.string().trim().min(5, 'Explique o motivo em ao menos 5 caracteres.').max(1000) }).parse(await request.json());
    const access = await requestAccess(id), me = access.me, r = access.request;
    const myTurn = r.mode === 'parallel' ? me?.status === 'pending' : access.current?.id === me?.id;
    if (r.status !== 'pending' || !me || !myTurn) throw Object.assign(new Error('Não há assinatura sua pendente nesta solicitação.'), { status: 409 });
    const returns = r.mode !== 'parallel' && me.step > 1;
    const next = returns ? crypto.randomUUID() : null;
    await sql.transaction([
      sql`UPDATE signature_signers SET status='rejected',reject_reason=${reason} WHERE id=${me.id}::uuid AND status='pending'`,
      sql`UPDATE signature_requests SET status='rejected',closed_reason=${reason} WHERE id=${id}::uuid AND status='pending'`,
      sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${access.user.id},${r.project_id}::uuid,'reject_signature','signature_request',${id},jsonb_build_object('reason',${reason}::text,'returnedTo',${next}::text))`,
      ...(next ? [
        sql`INSERT INTO signature_requests(id,project_id,source_kind,source_id,label,created_by,mode) VALUES(${next}::uuid,${r.project_id}::uuid,${r.source_kind},${r.source_id}::uuid,${r.label},${r.created_by},'sequential')`,
        ...access.signers.map((s) => sql`INSERT INTO signature_signers(request_id,step,auth_user_id,name,role_label,status) VALUES(${next}::uuid,${s.step},${s.auth_user_id},${s.name},${s.role_label},${s.step === 1 ? 'pending' : 'waiting'})`),
        sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${access.user.id},${r.project_id}::uuid,'return_to_beneficiary','signature_request',${next},jsonb_build_object('previous',${id}::text,'reason',${reason}::text,'by',${me.name}::text))`
      ] : [])
    ]);
    let delivery: Delivery | null = null;
    if (next) {
      try { delivery = await dispatchAfterSignature(next, 'signed', { by: me.name, role: me.role_label, reason }) || null; }
      catch (error) {
        console.error('return dispatch', next, error);
        delivery = { sent: false, reason: `Falha no envio pelo WhatsApp: ${(error as Error).message}`.slice(0, 300) };
      }
    }
    return Response.json({ rejected: true, returnedTo: next, delivery });
  } catch (error) { return travelError(error); }
}
