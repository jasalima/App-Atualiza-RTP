import { z } from 'zod';
import { sql } from '@/lib/db';
import { requestAccess } from '@/lib/signatures';
import { sameOrigin, travelError } from '@/lib/travel';

// The current signer refuses to sign, with a reason the team sees.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { id } = await params, { reason } = z.object({ reason: z.string().trim().min(5, 'Explique o motivo em ao menos 5 caracteres.').max(1000) }).parse(await request.json());
    const access = await requestAccess(id), me = access.me;
    const myTurn = access.request.mode === 'parallel' ? me?.status === 'pending' : access.current?.id === me?.id;
    if (access.request.status !== 'pending' || !me || !myTurn) throw Object.assign(new Error('Não há assinatura sua pendente nesta solicitação.'), { status: 409 });
    await sql.transaction([
      sql`UPDATE signature_signers SET status='rejected',reject_reason=${reason} WHERE id=${me.id}::uuid AND status='pending'`,
      sql`UPDATE signature_requests SET status='rejected',closed_reason=${reason} WHERE id=${id}::uuid AND status='pending'`,
      sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${access.user.id},${access.request.project_id}::uuid,'reject_signature','signature_request',${id},jsonb_build_object('reason',${reason}::text))`
    ]);
    return Response.json({ rejected: true });
  } catch (error) { return travelError(error); }
}
