import { z } from 'zod';
import { sql } from '@/lib/db';
import { clientIp, documentSource, normalizeCpf, requestAccess, sha256 } from '@/lib/signatures';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';

const input = z.object({ cpf: z.string().min(11).max(20), accept: z.literal(true, { message: 'Confirme a declaração para assinar.' }) });
const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

// Electronic signature of the current signer. What is signed is the SHA-256 of the
// document's content now; every signer signs the same hash, so the content is
// frozen from the first signature on. The record keeps CPF, time, IP and browser.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { id } = await params, body = input.parse(await request.json());
    const access = await requestAccess(id), r = access.request, me = access.me;
    if (r.status !== 'pending') throw fail('Esta solicitação de assinatura já foi encerrada.', 409);
    if (!me || access.current?.id !== me.id) throw fail(me?.status === 'signed' ? 'Você já assinou este documento.' : 'Aguarde a sua vez: o documento segue a ordem de assinatura.', 409);
    const cpf = normalizeCpf(body.cpf);
    if (!cpf) throw fail('CPF inválido. Confira os números.', 400);
    const [profile] = await sql`SELECT cpf FROM signer_profiles WHERE auth_user_id=${access.user.id}`;
    if (profile && profile.cpf !== cpf) throw fail('Este CPF não corresponde ao usado nas suas assinaturas anteriores. Procure a coordenação se precisar corrigi-lo.', 409);

    const source = await documentSource(String(r.project_id), r.source_kind as 'travel' | 'rtp', String(r.source_id));
    const previous = access.signers.filter((s) => s.status === 'signed');
    if (previous.some((s) => s.document_hash !== source.hash)) throw fail('O documento foi alterado depois da primeira assinatura. A coordenação precisa cancelar e solicitar novamente.', 409);

    const signedAt = new Date().toISOString(), ip = clientIp(request), userAgent = (request.headers.get('user-agent') ?? '').slice(0, 300);
    const signatureHash = sha256([source.hash, id, me.step, access.user.id, cpf, signedAt, ip].join('|'));
    const next = access.signers.filter((s) => s.step > me.step && s.status === 'waiting').sort((a, b) => a.step - b.step)[0];
    const finalHash = sha256([source.hash, ...previous.map((s) => s.signature_hash), signatureHash].join('|'));
    const code = finalHash.slice(0, 12).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
    // Every follow-up statement runs only if this signer's row really changed to signed (no double signing).
    const mine = sql`EXISTS(SELECT 1 FROM signature_signers WHERE id=${me.id}::uuid AND status='signed' AND signature_hash=${signatureHash})`;
    const [updated] = await sql.transaction([
      sql`UPDATE signature_signers SET status='signed',cpf=${cpf},signed_at=${signedAt}::timestamptz,ip=${ip},user_agent=${userAgent},document_hash=${source.hash},signature_hash=${signatureHash}
        WHERE id=${me.id}::uuid AND status='pending' RETURNING id`,
      next
        ? sql`UPDATE signature_signers SET status='pending' WHERE id=${next.id}::uuid AND status='waiting' AND ${mine}`
        : sql`UPDATE signature_requests SET status='completed',completed_at=now(),document_hash=${source.hash},verification_code=${code} WHERE id=${id}::uuid AND status='pending' AND ${mine}`,
      sql`INSERT INTO signer_profiles(auth_user_id,cpf) SELECT ${access.user.id},${cpf} WHERE ${mine} ON CONFLICT (auth_user_id) DO NOTHING`,
      sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) SELECT ${access.user.id},${r.project_id}::uuid,'sign','signature_request',${id},
        jsonb_build_object('step',${me.step}::int,'documentHash',${source.hash}::text,'signatureHash',${signatureHash}::text,'ip',${ip}::text) WHERE ${mine}`
    ]) as unknown as Array<Array<{ id: string }>>;
    if (!updated.length) throw fail('Assinatura já registrada ou solicitação alterada. Atualize a página.', 409);
    return Response.json({ signed: true, signedAt, signatureHash, documentHash: source.hash, completed: !next, verificationCode: next ? null : code });
  } catch (error) { return travelError(error); }
}
