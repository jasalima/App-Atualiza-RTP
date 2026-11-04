import { createHash } from 'node:crypto';
import { evolutionForProject } from './connectivity-config';
import { sql } from './db';
import { documentSource, loadRequest, signedFile, signerCandidates, signLink, verifyLink } from './signatures';
import { completedMessage, signatureMessage } from './signature-view';
import { putPrivateObject } from './storage';
import { ownWhatsApp } from './whatsapp-connections';

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

export async function dispatchAfterSignature(requestId: string) {
  const { request, signers } = await loadRequest(requestId);
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
  if (!target) return;
  // Whoever opened the request and signs next is already in the app: no message to themselves.
  if (!completed && target.authUserId === creator) return;
  if (!target.phone) return log(projectId, creator, requestId, 'dispatch_skipped', { reason: 'Destinatário sem telefone cadastrado.' });
  const connection = await ownWhatsApp(projectId, creator);
  if (!connection) return log(projectId, creator, requestId, 'dispatch_skipped', { reason: 'Quem abriu a solicitação não conectou o WhatsApp.' });
  const provider = await evolutionForProject(projectId);
  if (await provider.state(connection.instance, connection.token) !== 'open') return log(projectId, creator, requestId, 'dispatch_skipped', { reason: 'WhatsApp de quem abriu a solicitação está desconectado.' });

  const caption = completed
    ? completedMessage({ name: target.name, label: source.label, code: String(request.verification_code), verifyUrl: verifyLink(String(request.verification_code)), signers })
    : signatureMessage({ name: next!.name, label: source.label, link: signLink(requestId), firstAccess: target.pendingFirstAccess, from, signers, currentStep: next!.step });
  const file = { ...pdf, filename: completed ? pdf.filename.replace(/\.pdf$/, '-assinado.pdf') : pdf.filename };
  const result = await provider.sendDocument(connection.instance, connection.token, file, digits(target.phone), caption);
  await log(projectId, creator, requestId, completed ? 'send_signed' : 'notify_signer', { to: `•••• ${target.phone.replace(/\D/g, '').slice(-4)}`, messageId: result.messageId });
}
