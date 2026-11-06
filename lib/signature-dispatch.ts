import { createHash } from 'node:crypto';
import { evolutionForProject } from './connectivity-config';
import { sql } from './db';
import { documentSource, loadRequest, signedFile, signerCandidates, signLink, verifyLink } from './signatures';
import { completedMessage, returnedMessage, signatureMessage } from './signature-view';
import { putPrivateObject } from './storage';
import { minuteVerifyLink } from './minutes-core';
import { moduleSender, ownWhatsApp } from './whatsapp-connections';
import { externalRecipient } from './external-signatures';

// What happens after each signature, without making the signer wait:
// - someone still has to sign: that person receives, through the WhatsApp of whoever
//   opened the request, the PDF with the signatures collected so far and the link;
// - everyone signed: the signed PDF is archived in the project's documents and sent
//   to whoever opened the request, ready to attach to the FAPTO accountability.
// A failure here never undoes a signature: it is written to the audit trail and the
// team can still send the link or download the file from the signature panel.
const digits = (phone: string) => { const d = phone.replace(/\D/g, ''); return d.length === 10 || d.length === 11 ? `55${d}` : d; };
async function log(projectId: string, userId: string, requestId: string, action: string, metadata: Record<string, string | number>) {
  await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${userId},${projectId}::uuid,${action},'signature_request',${requestId},${JSON.stringify(metadata)}::jsonb)`;
}

export type Delivery = { sent: boolean; to?: string; reason?: string };
export type ReturnNote = { by: string; role: string; reason: string };
export async function dispatchAfterSignature(requestId: string, event: 'created' | 'signed' = 'signed', returned?: ReturnNote): Promise<Delivery | void> {
  const { request, signers } = await loadRequest(requestId);
  if (request.mode === 'parallel') return dispatchParallel(request, signers, event);
  const projectId = String(request.project_id), creator = String(request.created_by);
  const source = await documentSource(projectId, request.source_kind as 'travel' | 'rtp', String(request.source_id));
  const people = await signerCandidates(projectId), owner = people.find((p) => p.authUserId === creator);
  const from = { name: owner?.name ?? 'Coordenação do projeto', role: owner?.roleLabel ?? '' };
  const signed = signers.filter((s) => s.status === 'signed');
  const pdf = await signedFile(source, 'pdf');
  const completed = request.status === 'completed';

  // Archive first: the signed file must exist in the repository even if WhatsApp is offline.
  if (completed && !request.archived_document_id) {
    const key = `${projectId}/${creator}/signed/${requestId}.pdf`, sha256 = createHash('sha256').update(pdf.buffer).digest('hex');
    await putPrivateObject(key, pdf.buffer, 'application/pdf');
    const [doc] = await sql`INSERT INTO documents(project_id,scholar_id,kind,category,title,description,original_name,mime_type,size_bytes,storage_key,sha256,extraction_status,created_by,version)
      VALUES(${projectId}::uuid,${source.scholarId}::uuid,'project_document','report',${`${source.label} — assinado`},${`Assinado eletronicamente por ${signed.map((s) => s.name).join(' e ')}. Código de verificação ${request.verification_code}.`},
        ${pdf.filename.replace(/\.pdf$/, '-assinado.pdf')},'application/pdf',${pdf.buffer.length},${key},${sha256},'not_applicable',${creator},1)
      ON CONFLICT (storage_key) DO UPDATE SET updated_at=now() RETURNING id`;
    await sql`UPDATE signature_requests SET archived_document_id=${doc.id}::uuid WHERE id=${requestId}::uuid`;
    await log(projectId, creator, requestId, 'archive_signed', { documentId: String(doc.id) });
  }

  const next = signers.find((s) => s.status === 'pending');
  const target = completed ? owner : next ? people.find((p) => p.authUserId === next.auth_user_id) : undefined;
  if (!target) return { sent: false, reason: 'Não há quem deva receber o link agora.' };
  const skip = async (reason: string): Promise<Delivery> => { await log(projectId, creator, requestId, 'dispatch_skipped', { reason }); return { sent: false, reason }; };
  // Whoever opened the request and signs next is already in the app: no message to themselves.
  if (!completed && target.authUserId === creator) return { sent: false, reason: 'Você é quem assina agora: abra a página de assinatura.' };
  if (!target.phone) return skip(`${target.name} não tem telefone cadastrado.`);
  const connection = await ownWhatsApp(projectId, creator);
  if (!connection) return skip('Quem abriu a solicitação não conectou o WhatsApp (seção Conectividade).');
  const provider = await evolutionForProject(projectId);
  if (await provider.state(connection.instance, connection.token) !== 'open') return skip('O WhatsApp de quem abriu a solicitação está desconectado. Abra Conectividade e escaneie o QR Code.');

  const caption = completed
    ? completedMessage({ name: target.name, label: source.label, code: String(request.verification_code), verifyUrl: verifyLink(String(request.verification_code)), signers })
    : returned
    ? returnedMessage({ name: next!.name, label: source.label, link: signLink(requestId), by: returned.by, role: returned.role, reason: returned.reason, firstAccess: target.pendingFirstAccess })
    : signatureMessage({ name: next!.name, label: source.label, link: signLink(requestId), firstAccess: target.pendingFirstAccess, from, signers, currentStep: next!.step });
  const file = { ...pdf, filename: completed ? pdf.filename.replace(/\.pdf$/, '-assinado.pdf') : pdf.filename };
  const result = await provider.sendDocument(connection.instance, connection.token, file, digits(target.phone), caption);
  const to = `•••• ${target.phone.replace(/\D/g, '').slice(-4)}`;
  await log(projectId, creator, requestId, completed ? 'send_signed' : returned ? 'notify_returned' : 'notify_signer', { to, messageId: result.messageId });
  return { sent: true, to };
}

/* Atas (mode 'parallel') ------------------------------------------------------------------------ */
type Loaded = Awaited<ReturnType<typeof loadRequest>>;
// Every participant receives the ata at once, through the WhatsApp of whoever opened the request.
// Each signature refreshes the official PDF (kept for file verification); the last one archives
// the signed ata in Documents and sends it to whoever opened the request.
async function dispatchParallel(request: Loaded['request'], signers: Loaded['signers'], event: 'created' | 'signed') {
  const requestId = String(request.id), projectId = String(request.project_id), creator = String(request.created_by), completed = request.status === 'completed';
  const source = await documentSource(projectId, 'minutes', String(request.source_id));
  const pdf = await signedFile(source, 'pdf');
  if (event === 'signed' && !completed) return;
  const minute = source.minutes!, code = String(minute.public_code);
  if (completed && !request.archived_document_id) {
    const key = `${projectId}/minutes/${minute.minute_id}/signed/${requestId}.pdf`, sha256 = createHash('sha256').update(pdf.buffer).digest('hex');
    await putPrivateObject(key, pdf.buffer, 'application/pdf');
    const [doc] = await sql`INSERT INTO documents(project_id,scholar_id,kind,category,title,description,original_name,mime_type,size_bytes,storage_key,sha256,extraction_status,created_by,version)
      VALUES(${projectId}::uuid,NULL,'project_document','minutes',${`${source.label} — assinada`},${`Assinada eletronicamente por ${signers.map((s) => s.name).join(', ')}. Código de verificação ${code}.`},
        ${pdf.filename},'application/pdf',${pdf.buffer.length},${key},${sha256},'not_applicable',${creator},1)
      ON CONFLICT (storage_key) DO UPDATE SET updated_at=now() RETURNING id`;
    await sql`UPDATE signature_requests SET archived_document_id=${doc.id}::uuid WHERE id=${requestId}::uuid`;
    await log(projectId, creator, requestId, 'archive_signed', { documentId: String(doc.id) });
  }
  // The atas go out from the number of the person responsible for them in the project
  // ("Envio das atas pelo WhatsApp"), or from whoever opened the request.
  const sender = await moduleSender(projectId, 'minutes_sender', creator);
  if (!sender.connection || !sender.userId) return log(projectId, creator, requestId, 'dispatch_skipped', { reason: sender.designated ? 'O WhatsApp do responsável pelos envios das atas e o de quem abriu a solicitação estão desconectados.' : 'Quem abriu a solicitação não conectou o WhatsApp.' });
  const from_ = sender.userId;
  const people = await signerCandidates(projectId), owner = people.find((p) => p.authUserId === creator), voice = people.find((p) => p.authUserId === from_) ?? owner;
  // Requests: every pending participant (not the sender, not who opened it, who is already in the app).
  // Conclusion: the signed ata to every participant and to who opened the request.
  const ids = completed
    ? [...new Set([...signers.map((s) => s.auth_user_id), creator])]
    : signers.filter((s) => s.status === 'pending' && s.auth_user_id !== creator).map((s) => s.auth_user_id);
  const targets = await Promise.all(ids.filter((uid) => uid !== from_).map(async (uid) => {
    const slot = signers.find(s => s.auth_user_id === uid);
    const external = uid.startsWith('external:') && slot ? await externalRecipient(slot.id, completed) : null;
    return { person: external ? { name: slot!.name, phone: external.phone, pendingFirstAccess: false } : people.find((p) => p.authUserId === uid), signer: completed ? null : slot ?? null, uid, external };
  }));
  if (!targets.length) return;
  const from = { name: voice?.name ?? 'Coordenação do projeto', role: voice?.roleLabel ?? '' };
  for (const { person, signer, uid, external } of targets) {
    const name = signer?.name ?? person?.name ?? signers.find((s) => s.auth_user_id === uid)?.name ?? 'Destinatário';
    if (!person?.phone) { await log(projectId, from_, requestId, 'dispatch_skipped', { reason: `${name} sem telefone cadastrado.` }); continue; }
    const caption = signer && external
      ? `RTP Inteligente\nOlá, ${signer.name}. Você foi convidado(a) a assinar ${source.label}.\nLeia e assine pelo seu link individual: ${external.link}\nNão é necessário criar conta. Confirme seu CPF e o código enviado ao seu WhatsApp. O link vale por 7 dias. Não compartilhe o link nem o código.`
      : signer
      ? signatureMessage({ name: signer.name, label: source.label, link: signLink(requestId), firstAccess: person.pendingFirstAccess, from, signers, currentStep: signer.step, parallel: true })
      : completedMessage({ name: person.name, label: source.label, code, verifyUrl: minuteVerifyLink(code), signers, parallel: true });
    try {
      const result = await sender.provider.sendDocument(sender.connection.instance, sender.connection.token, pdf, digits(person.phone), caption);
      await log(projectId, from_, requestId, signer ? 'notify_signer' : 'send_signed', { to: `•••• ${person.phone.replace(/\D/g, '').slice(-4)}`, messageId: result.messageId });
    } catch (error) { await log(projectId, from_, requestId, 'dispatch_skipped', { reason: `Falha no envio para ${name}: ${(error as Error).message}`.slice(0, 300) }); }
  }
}
