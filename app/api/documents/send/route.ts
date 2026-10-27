import { z } from 'zod';
import { sql } from '../../../../lib/db';
import { documentRequest, loadDocumentSource, MAX_DOCUMENT_BYTES, recipientNumber } from '../../../../lib/document-source';
import { sameOrigin, travelError } from '../../../../lib/travel';
import { ownWhatsApp } from '../../../../lib/whatsapp-connections';
import { evolutionForProject } from '../../../../lib/connectivity-config';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = documentRequest.extend({ recipientPhone: z.string().min(1).max(35), requestId: z.string().uuid() }).parse(await request.json());
    const number = recipientNumber(input.recipientPhone);
    const source = await loadDocumentSource(input);
    const { user } = source.session;
    const connection = await ownWhatsApp(input.projectId, user.id);
    if (!connection) return Response.json({ error: 'Conecte seu WhatsApp na seção Conectividade antes de enviar.' }, { status: 409 });
    const provider = await evolutionForProject(input.projectId);
    if (await provider.state(connection.instance, connection.token) !== 'open') return Response.json({ error: 'Seu WhatsApp está desconectado. Abra Conectividade e escaneie o QR Code.' }, { status: 409 });
    const file = await source.makeFile();
    if (file.buffer.length > MAX_DOCUMENT_BYTES) return Response.json({ error: 'O documento excede o limite de 20 MB.' }, { status: 413 });
    const claimed = await sql`INSERT INTO document_deliveries(project_id,auth_user_id,request_id,source_kind,source_id,source_version,file_name,format,recipient_phone,status)
      SELECT ${input.projectId}::uuid,${user.id},${input.requestId}::uuid,${input.kind},${input.sourceId}::uuid,${source.version},${file.filename},${input.format},${number},'sending'
      WHERE pg_try_advisory_xact_lock(hashtext(${user.id}),hashtext(${input.projectId}))
      AND NOT EXISTS(SELECT 1 FROM document_deliveries WHERE auth_user_id=${user.id} AND project_id=${input.projectId}::uuid AND created_at>now()-interval '30 seconds')
      ON CONFLICT DO NOTHING RETURNING id`;
    if (!claimed.length) return Response.json({ error: 'Envio já solicitado ou realizado recentemente. Confira o WhatsApp e aguarde 30 segundos antes de uma nova tentativa.' }, { status: 409 });
    try {
      const result = await provider.sendDocument(connection.instance, connection.token, file, number, `${source.label}. Documento do projeto.`);
      await sql.transaction([
        sql`UPDATE document_deliveries SET status='accepted',provider_message_id=${result.messageId},updated_at=now() WHERE id=${claimed[0].id}::uuid`,
        sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${user.id},${input.projectId}::uuid,'send_document','document_delivery',${String(claimed[0].id)},jsonb_build_object('sourceKind',${input.kind}::text,'sourceId',${input.sourceId}::text,'version',${source.version}::int))`,
        ...(input.kind === 'rtp' ? [sql`UPDATE reports SET status='exported' WHERE id=${input.sourceId}::uuid AND project_id=${input.projectId}::uuid AND status='approved' AND current_version=${source.version}`] : [])
      ]);
      return Response.json({ success: true, deliveryId: claimed[0].id, status: 'accepted' }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch {
      await sql`UPDATE document_deliveries SET status='uncertain',updated_at=now() WHERE id=${claimed[0].id}::uuid`;
      return Response.json({ error: 'Não foi possível confirmar o envio. Confira o WhatsApp antes de tentar novamente.' }, { status: 502 });
    }
  } catch (error) { return travelError(error); }
}
