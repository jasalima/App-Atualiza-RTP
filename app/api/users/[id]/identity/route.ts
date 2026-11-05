import { z } from 'zod';
import { requireAdmin } from '@/lib/authorize';
import { sql } from '@/lib/db';
import { normalizeCpf } from '@/lib/cpf';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    await requireAdmin();
    const { id } = await params;
    const [identity] = await sql`SELECT cpf,phone,verified_at FROM signer_identities WHERE auth_user_id=${id}`;
    return Response.json(identity ?? { cpf: '', phone: '' }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
export async function PUT(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const admin = await requireAdmin(), { id } = await params;
    const body = z.object({ cpf: z.string().max(20), phone: z.string().max(35).default(''), reason: z.string().trim().min(5).max(500) }).parse(await request.json());
    const cpf = normalizeCpf(body.cpf), phone = body.phone.replace(/\D/g, '');
    if (!cpf || (phone && !/^\d{12,15}$/.test(phone))) return Response.json({ error: 'Confira o CPF e o telefone com DDI e DDD.' }, { status: 400 });
    const [account] = await sql`SELECT id FROM neon_auth."user" WHERE id::text=${id}`;
    if (!account) return Response.json({ error: 'Conta não encontrada.' }, { status: 404 });
    await sql.transaction([
      sql`INSERT INTO signer_identities(auth_user_id,cpf,phone,verified_by) VALUES(${id},${cpf},${phone},${admin.id})
        ON CONFLICT(auth_user_id) DO UPDATE SET cpf=EXCLUDED.cpf,phone=EXCLUDED.phone,verified_by=EXCLUDED.verified_by,verified_at=now()`,
      sql`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,metadata) VALUES(${admin.id},'confirm_identity','user',${id},jsonb_build_object('reason',${body.reason}::text))`
    ]);
    return Response.json({ saved: true });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return Response.json({ error: 'Este CPF já está vinculado a outra conta. Confira o cadastro antes de continuar.' }, { status: 409 });
    return travelError(error);
  }
}
