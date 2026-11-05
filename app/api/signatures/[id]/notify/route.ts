import { z } from 'zod';
import { sql } from '@/lib/db';
import { evolutionForProject } from '@/lib/connectivity-config';
import { recipientNumber, sender } from '@/lib/document-source';
import { requestAccess, signLink, signerCandidates } from '@/lib/signatures';
import { signatureMessage } from '@/lib/signature-view';
import { sameOrigin, travelError } from '@/lib/travel';
import { moduleSender, ownWhatsApp } from '@/lib/whatsapp-connections';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { id } = await params, body = z.object({ phone: z.string().max(35).optional(), signerId: z.string().uuid().optional() }).parse(await request.json().catch(() => ({})));
    const access = await requestAccess(id), r = access.request, projectId = String(r.project_id);
    if (!access.manager) throw Object.assign(new Error('Somente a coordenação envia links de assinatura.'), { status: 403 });
    // Atas: any pending participant may be reminded; ordered documents: the person whose turn it is.
    const parallel = r.mode === 'parallel';
    const current = parallel ? access.signers.find((s) => s.status === 'pending' && (!body.signerId || s.id === body.signerId)) : access.current;
    if (r.status !== 'pending' || !current) throw Object.assign(new Error('Não há assinatura pendente nesta solicitação.'), { status: 409 });
    const target = (await signerCandidates(projectId)).find((c) => c.authUserId === current.auth_user_id);
    const phone = body.phone?.trim() || target?.phone || '';
    if (!phone) throw Object.assign(new Error('O signatário não tem telefone cadastrado. Informe o número para envio.'), { status: 400 });
    const number = recipientNumber(phone);
    // Atas go out from the number of the person responsible for them (or from the caller).
    const chosen = parallel ? await moduleSender(projectId, 'minutes_sender', access.user.id) : null;
    if (parallel && !chosen?.connection) throw Object.assign(new Error(chosen?.designated ? 'O WhatsApp do responsável pelos envios das atas está desconectado, e o seu também.' : 'Conecte seu WhatsApp na seção Conectividade antes de enviar.'), { status: 409 });
    const connection = parallel ? chosen!.connection! : await ownWhatsApp(projectId, access.user.id);
    if (!connection) throw Object.assign(new Error('Conecte seu WhatsApp na seção Conectividade antes de enviar.'), { status: 409 });
    const provider = parallel ? chosen!.provider : await evolutionForProject(projectId);
    if (!parallel && await provider.state(connection.instance, connection.token) !== 'open') throw Object.assign(new Error('Seu WhatsApp está desconectado. Abra Conectividade e escaneie o QR Code.'), { status: 409 });
    const [role] = await sql`SELECT role FROM user_project_access WHERE auth_user_id=${access.user.id} AND (project_id=${projectId}::uuid OR role='admin') ORDER BY (role='admin') DESC LIMIT 1`;
    const from = await sender({ user: access.user, role: String(role?.role ?? 'coordinator'), scholarId: null }, projectId);
    const text = signatureMessage({ name: current.name, label: String(r.label), link: signLink(id), firstAccess: !!target?.pendingFirstAccess, from, signers: access.signers, currentStep: current.step, parallel });
    const result = await provider.sendText(connection.instance, connection.token, number, text);
    await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${access.user.id},${projectId}::uuid,'notify_signer','signature_request',${id},jsonb_build_object('step',${current.step}::int,'messageId',${result.messageId}::text))`;
    return Response.json({ sent: true, to: `•••• ${number.slice(-4)}` });
  } catch (error) { return travelError(error); }
}
