import { z } from 'zod';
import { sql } from '@/lib/db';
import { loadTravel, sameOrigin, travelError, travelFile, travelQuery } from '@/lib/travel';
import { ownWhatsApp } from '@/lib/whatsapp-connections';
import { Evolution } from '@/server/services/evolution';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = travelQuery.extend({ requestId: z.string().uuid() }).parse(await request.json());
    const { session, beneficiary } = await loadTravel(body.projectId, body.scholarId);
    const number = beneficiary.phone.replace(/\D/g, '');
    if (!/^[1-9]\d{9,14}$/.test(number)) return Response.json({ error: 'Cadastre o telefone do beneficiário com DDI e DDD (ex.: 5563999999999).' }, { status: 400 });
    const connection = await ownWhatsApp(body.projectId, session.user.id);
    const base = process.env.EVOLUTION_API_URL;
    if (!connection || !base) return Response.json({ error: 'Configure sua conexão WhatsApp para este projeto.' }, { status: 409 });
    const endpoint = new URL(`${base.replace(/\/$/, '')}/message/sendMedia/${encodeURIComponent(String(connection.instance))}`);
    if (endpoint.protocol !== 'https:') return Response.json({ error: 'A conexão Evolution deve usar HTTPS.' }, { status: 503 });
    if (await new Evolution().state(connection.instance, connection.token) !== 'open') return Response.json({ error: 'Conecte seu WhatsApp pelo QR Code antes de enviar.' }, { status: 409 });
    const file = await travelFile(beneficiary, body.format);
    const apiKey = connection.token;
    // Atomic claim also limits double clicks and repeated requests. Never retry an ambiguous provider response automatically.
    const claimed = await sql`INSERT INTO travel_document_sends(project_id,auth_user_id,scholar_id,request_id,status)
      SELECT ${body.projectId}::uuid,${session.user.id},${body.scholarId}::uuid,${body.requestId}::uuid,'sending'
      WHERE pg_try_advisory_xact_lock(hashtext(${session.user.id}),hashtext(${body.projectId}))
      AND NOT EXISTS(SELECT 1 FROM travel_document_sends WHERE auth_user_id=${session.user.id} AND project_id=${body.projectId}::uuid AND created_at>now()-interval '30 seconds')
      ON CONFLICT DO NOTHING RETURNING id`;
    if (!claimed.length) return Response.json({ error: 'Envio já solicitado. Aguarde e confira o WhatsApp antes de repetir.' }, { status: 409 });
    try {
      const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000), headers: { 'Content-Type': 'application/json', apikey: apiKey }, body: JSON.stringify({ number, mediatype: 'document', mimetype: file.mime, media: file.buffer.toString('base64'), fileName: file.filename, caption: `Formulário 26 — ${beneficiary.project}. Preencha os campos da viagem e assine o relatório.` }) });
      if (!response.ok) throw new Error('Provider rejected request');
      await sql`UPDATE travel_document_sends SET status='accepted' WHERE id=${claimed[0].id}::uuid`;
      return Response.json({ success: true });
    } catch {
      await sql`UPDATE travel_document_sends SET status='uncertain' WHERE id=${claimed[0].id}::uuid`;
      return Response.json({ error: 'Não foi possível confirmar o envio. Confira o WhatsApp antes de tentar novamente.' }, { status: 502 });
    }
  } catch (error) { return travelError(error); }
}
