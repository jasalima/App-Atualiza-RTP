import { signLink, type SignerRow } from './signatures';
import { maskCpf } from '../server/services/signature-stamp';

// Shapes returned to the browser. CPFs are always masked; IPs are shown only on the document's manifest.
const iso = (d: unknown) => d instanceof Date ? d.toISOString() : d ? String(d) : null;
export const signerView = (s: SignerRow) => ({ id: s.id, step: s.step, name: s.name, roleLabel: s.role_label, status: s.status, signedAt: iso(s.signed_at), cpf: s.cpf ? maskCpf(s.cpf) : null, rejectReason: s.reject_reason, signatureHash: s.signature_hash, ip: s.ip });
export const requestView = (r: Record<string, unknown>, signers: Array<SignerRow & { request_id?: string }>) => ({
  id: String(r.id), projectId: String(r.project_id), kind: String(r.source_kind), sourceId: String(r.source_id), label: String(r.label), status: String(r.status),
  createdAt: iso(r.created_at), completedAt: iso(r.completed_at), verificationCode: r.verification_code ? String(r.verification_code) : null,
  documentHash: r.document_hash ? String(r.document_hash) : null, closedReason: r.closed_reason ? String(r.closed_reason) : null,
  link: signLink(String(r.id)), signers: signers.filter((s) => s.request_id === undefined || s.request_id === r.id).map(signerView)
});

/* WhatsApp messages of the signature flow ------------------------------------------------------ */
type Stage = Pick<SignerRow, 'step' | 'name' | 'status' | 'signed_at'>;
const RULE = '━━━━━━━━━━━━━━━';
const shortWhen = (d: unknown) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(d as string)).replace(',', ' às');
/** Progress of the signatures, one line per stage, ending with the delivery of the signed file. */
export function stagesText(signers: Stage[], o: { completed: boolean; currentStep?: number }) {
  const lines = [...signers].sort((a, b) => a.step - b.step).map((s) => {
    const who = `${s.step}. ${s.name} — ${s.step === 1 ? 'Beneficiário' : 'Coordenação'}`;
    if (s.status === 'signed') return `✅ ${who}\n      _assinado em ${shortWhen(s.signed_at)}_`;
    if (s.status === 'rejected') return `❌ ${who}\n      _recusou_`;
    return s.step === o.currentStep ? `✍️ ${who}\n      *aguardando você*` : `⏳ ${who}\n      _na fila_`;
  });
  lines.push(`${o.completed ? '✅' : '⏳'} ${signers.length + 1}. PDF assinado enviado à administração${o.completed ? '\n      _arquivado em Documentos_' : ''}`);
  return ['📋 *Etapas da assinatura*', ...lines].join('\n');
}

/** WhatsApp text with the signing link for the person whose turn it is. */
export function signatureMessage(o: { name: string; label: string; link: string; firstAccess: boolean; from: { name: string; role: string }; signers?: Stage[]; currentStep?: number }) {
  const signedBy = (o.signers ?? []).filter((s) => s.status === 'signed').map((s) => s.name);
  return [
    '✍️ *ASSINATURA ELETRÔNICA* · RTP Inteligente',
    '',
    `Olá, ${o.name.split(/\s+/)[0]}! 👋 Esta mensagem é automática.`,
    '',
    `📄 *Documento:* ${o.label}`,
    signedBy.length ? `🖊️ Já assinado por *${signedBy.join('* e *')}*. Segue em anexo a versão com ${signedBy.length > 1 ? 'as assinaturas registradas' : 'a assinatura registrada'}.` : '🖊️ O documento aguarda a sua assinatura. Segue em anexo para leitura.',
    '',
    RULE,
    ...(o.signers?.length ? [stagesText(o.signers, { completed: false, currentStep: o.currentStep }), RULE] : []),
    '',
    `👉 *Leia, ajuste se necessário e assine sem baixar nada:*\n${o.link}`,
    '',
    o.firstAccess ? '🔐 Entre com o seu e-mail e a senha temporária enviada pela coordenação. No primeiro acesso você criará a sua senha definitiva.' : '🔐 Entre com o seu e-mail e a sua senha do RTP Inteligente.',
    '🛡️ Sua assinatura registra nome, CPF, data, hora, IP e o hash SHA-256 do documento.',
    '',
    'Atenciosamente,',
    `*${o.from.name}*`,
    o.from.role
  ].join('\n');
}

/** WhatsApp text that delivers the fully signed PDF to whoever opened the request. */
export function completedMessage(o: { name: string; label: string; code: string; verifyUrl: string; signers: Stage[] }) {
  return [
    '🎉 *DOCUMENTO ASSINADO POR TODOS* · RTP Inteligente',
    '',
    `Olá, ${o.name.split(/\s+/)[0]}! 👋 Esta mensagem é automática.`,
    '',
    `📄 *Documento:* ${o.label}`,
    '',
    RULE,
    stagesText(o.signers, { completed: true }),
    RULE,
    '',
    `🔎 *Código de verificação:* ${o.code}`,
    o.verifyUrl,
    '',
    '📎 Segue o PDF assinado para anexar à prestação de contas no sistema da FAPTO.',
    '🗂️ Uma cópia também está salva em *Documentos*, no RTP Inteligente.'
  ].join('\n');
}
