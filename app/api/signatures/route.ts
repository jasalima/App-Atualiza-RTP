import { after } from 'next/server';
import { z } from 'zod';
import { requireProject, requireUser } from '@/lib/authorize';
import { sql } from '@/lib/db';
import { documentSource, signLink, signerCandidates, type SignerRow } from '@/lib/signatures';
import { requestView } from '@/lib/signature-view';
import { dispatchAfterSignature } from '@/lib/signature-dispatch';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';

type Row = SignerRow & { request_id: string };
// ?mine=1: requests waiting for or signed by the session (signature-only accounts land here).
// ?projectId&kind&sourceId: history of one document, for the team.
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    if (query.get('mine')) {
      const { user, mustChangePassword } = await requireUser();
      if (mustChangePassword) throw Object.assign(new Error('Troque a senha temporária antes de continuar.'), { status: 428 });
      const rows = await sql`SELECT r.*,p.title AS project_title,me.status AS my_status,me.step AS my_step FROM signature_requests r
        JOIN signature_signers me ON me.request_id=r.id AND me.auth_user_id=${user.id} JOIN projects p ON p.id=r.project_id
        WHERE r.status<>'cancelled' ORDER BY (me.status='pending' AND r.status='pending') DESC, r.created_at DESC LIMIT 100`;
      const signers = rows.length ? await sql`SELECT * FROM signature_signers WHERE request_id=ANY(${rows.map((r) => r.id)}::uuid[]) ORDER BY step` as Row[] : [];
      return Response.json(rows.map((r) => ({ ...requestView(r, signers), projectTitle: String(r.project_title), myStatus: String(r.my_status), myStep: Number(r.my_step) })), { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const projectId = z.string().uuid().parse(query.get('projectId')), kind = z.enum(['travel', 'rtp']).parse(query.get('kind')), sourceId = z.string().uuid().parse(query.get('sourceId'));
    const session = await requireProject(projectId);
    const source = await documentSource(projectId, kind, sourceId);
    if (session.role === 'scholar' && session.scholarId !== source.scholarId) throw Object.assign(new Error('Acesso negado.'), { status: 403 });
    const rows = await sql`SELECT * FROM signature_requests WHERE project_id=${projectId}::uuid AND source_kind=${kind} AND source_id=${sourceId}::uuid ORDER BY created_at DESC LIMIT 20`;
    const signers = rows.length ? await sql`SELECT * FROM signature_signers WHERE request_id=ANY(${rows.map((r) => r.id)}::uuid[]) ORDER BY step` as Row[] : [];
    return Response.json(rows.map((r) => requestView(r, signers)), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}

const createInput = z.object({ projectId: z.string().uuid(), kind: z.enum(['travel', 'rtp']), sourceId: z.string().uuid(), signers: z.array(z.string().min(1)).min(1).max(4) });
// The team opens a request: signers sign in the given order (member first, then coordination).
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = createInput.parse(await request.json());
    if (new Set(input.signers).size !== input.signers.length) throw Object.assign(new Error('Cada pessoa assina uma única vez.'), { status: 400 });
    const session = await requireProject(input.projectId, true);
    const source = await documentSource(input.projectId, input.kind, input.sourceId);
    const candidates = new Map((await signerCandidates(input.projectId)).map((c) => [c.authUserId, c]));
    const chosen = input.signers.map((id) => candidates.get(id));
    if (chosen.some((c) => !c)) throw Object.assign(new Error('Um dos signatários não tem acesso ativo a este projeto.'), { status: 400 });
    const id = crypto.randomUUID();
    try {
      await sql.transaction([
        sql`INSERT INTO signature_requests(id,project_id,source_kind,source_id,label,created_by) VALUES(${id}::uuid,${input.projectId}::uuid,${input.kind},${input.sourceId}::uuid,${source.label},${session.user.id})`,
        ...chosen.map((c, i) => sql`INSERT INTO signature_signers(request_id,step,auth_user_id,name,role_label,status) VALUES(${id}::uuid,${i + 1},${c!.authUserId},${c!.name},${c!.roleLabel},${i ? 'waiting' : 'pending'})`),
        sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${session.user.id},${input.projectId}::uuid,'request_signatures','signature_request',${id},jsonb_build_object('kind',${input.kind}::text,'sourceId',${input.sourceId}::text,'signers',${chosen.length}::int))`
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw Object.assign(new Error('Este documento já tem uma solicitação de assinatura em andamento.'), { status: 409 });
      throw error;
    }
    // The first signer (usually the beneficiary) receives the document and the link right away.
    after(() => dispatchAfterSignature(id).catch((error) => console.error('signature dispatch', id, error)));
    return Response.json({ id, link: signLink(id) }, { status: 201 });
  } catch (error) { return travelError(error); }
}
