import { signLink, type SignerRow } from './signatures';
import { maskCpf } from '../server/services/signature-stamp';

// Shapes returned to the browser. CPFs are always masked; IPs are shown only on the document's manifest.
const iso = (d: unknown) => d instanceof Date ? d.toISOString() : d ? String(d) : null;
export const signerView = (s: SignerRow) => ({ id: s.id, step: s.step, name: s.name, roleLabel: s.role_label, status: s.status, signedAt: iso(s.signed_at), cpf: s.cpf ? maskCpf(s.cpf) : null, rejectReason: s.reject_reason });
export const requestView = (r: Record<string, unknown>, signers: Array<SignerRow & { request_id?: string }>) => ({
  id: String(r.id), projectId: String(r.project_id), kind: String(r.source_kind), sourceId: String(r.source_id), label: String(r.label), status: String(r.status),
  createdAt: iso(r.created_at), completedAt: iso(r.completed_at), verificationCode: r.verification_code ? String(r.verification_code) : null,
  documentHash: r.document_hash ? String(r.document_hash) : null, closedReason: r.closed_reason ? String(r.closed_reason) : null,
  link: signLink(String(r.id)), signers: signers.filter((s) => s.request_id === undefined || s.request_id === r.id).map(signerView)
});

/** WhatsApp text with the signing link for the person whose turn it is. */
export function signatureMessage(o: { name: string; label: string; link: string; firstAccess: boolean; from: { name: string; role: string }; signedBy?: string[] }) {
  return [
    `Olá, ${o.name.split(/\s+/)[0]}! Esta mensagem é automática.`,
    o.signedBy?.length
      ? `O documento ${o.label} já foi assinado por ${o.signedBy.join(' e ')} e agora aguarda a sua assinatura eletrônica. Segue em anexo a versão com a assinatura registrada.`
      : `O documento ${o.label} aguarda a sua assinatura eletrônica.`,
    '',
    `Para ler, ajustar se necessário e assinar sem baixar nada, acesse: ${o.link}`,
    o.firstAccess ? 'Entre com o seu e-mail e a senha temporária enviada pela coordenação; no primeiro acesso você criará a sua senha definitiva.' : 'Entre com o seu e-mail e a sua senha do RTP Inteligente.',
    '',
    'Atenciosamente,',
    `*${o.from.name}*`,
    o.from.role
  ].join('\n');
}
