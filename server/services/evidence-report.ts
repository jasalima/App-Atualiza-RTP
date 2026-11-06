import PDFDocument from 'pdfkit';
import { sql } from '../../lib/db';
import { sha256 } from '../../lib/hash';
import { LEGAL_BASIS } from '../../lib/legal';
import { checkEvidence, evidenceVerdict, serverKey } from '../../lib/signature-evidence';
import { drawQr } from './minutes-pdf';

/*
 * "Comprovante técnico de assinaturas": a report of what the platform recorded for each signature
 * of a document and of the checks performed at the moment the report is generated. It states its
 * own generation time and does not present itself as contemporary evidence; it shows, for each
 * signature, whether evidence exists (procedure RTP-ASSINATURA-2) or not (earlier signatures).
 * Personal data is limited to what the public verification shows (masked CPF, no IP).
 */
type Signer = { id: string; step: number; name: string; role_label: string; cpf: string | null; signed_at: Date | string | null; signature_hash: string | null; status: string };
export type ReportInput = { requestId: string; documentLabel: string; project: string; code: string; verifyUrl: string; status: string; documentHash: string | null; version?: number | null; issuedAt?: string | null };

const when = (d: unknown) => {
  if (!d) return '—';
  const date = new Date(String(d instanceof Date ? d.toISOString() : d));
  const br = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' }).format(date);
  return `${br} (Brasília) · ${date.toISOString()} (UTC)`;
};
const mask = (cpf: string | null) => (cpf && /^\d{11}$/.test(cpf) ? `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**` : '—');
const METHOD: Record<string, string> = {
  conta_pessoal_cpf_confirmado: 'Login pessoal com sessão recente; CPF conferido com o vinculado à conta pela administração',
  link_individual_cpf_codigo_whatsapp: 'Link individual; CPF conferido; código de uso único enviado ao WhatsApp cadastrado'
};
const STATUS: Record<string, string> = { completed: 'Concluída (todas as assinaturas)', pending: 'Em andamento', cancelled: 'Cancelada', rejected: 'Recusada' };

export async function evidenceReport(input: ReportInput): Promise<Buffer> {
  const signers = await sql`SELECT id,step,name,role_label,cpf,signed_at,signature_hash,status FROM signature_signers WHERE request_id=${input.requestId}::uuid ORDER BY step` as Signer[];
  const evidence = await checkEvidence(input.requestId), key = serverKey();
  const generatedAt = new Date().toISOString();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 }, info: { Title: `Comprovante técnico de assinaturas — ${input.code}`, Author: 'RTP Inteligente', CreationDate: new Date(generatedAt) } });
    const chunks: Buffer[] = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = doc.page.width - 100, X = 50;
    const h = (t: string) => { doc.moveDown(0.6); doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#12303A').text(t, X, doc.y, { width: W }); doc.moveDown(0.25); doc.fillColor('#000'); };
    const line = (label: string, value: string, mono = false) => { doc.font('Helvetica-Bold').fontSize(8.6).text(`${label}: `, X, doc.y, { width: W, continued: true }); doc.font(mono ? 'Courier' : 'Helvetica').fontSize(mono ? 7.8 : 8.6).text(value, { width: W }); };

    doc.font('Helvetica-Bold').fontSize(14).text('COMPROVANTE TÉCNICO DE ASSINATURAS ELETRÔNICAS', X, 50, { width: W - 90 });
    doc.font('Helvetica').fontSize(8.6).fillColor('#444').text('Plataforma RTP Inteligente — relatório dos registros de assinatura e das conferências realizadas no momento da geração.', X, doc.y + 2, { width: W - 90 });
    drawQr(doc, input.verifyUrl, X + W - 78, 46, 78);
    doc.fillColor('#000'); doc.y = Math.max(doc.y, 132);

    h('1. Documento');
    line('Documento', input.documentLabel); line('Projeto', input.project); line('Código de verificação', input.code);
    if (input.version) line('Versão', String(input.version));
    if (input.issuedAt) line('Emissão da versão', when(input.issuedAt));
    line('Situação da solicitação', STATUS[input.status] ?? input.status);
    line('Hash SHA-256 do conteúdo assinado', input.documentHash ?? '—', true);
    line('Verificação pública', input.verifyUrl);

    h('2. Assinaturas e evidências');
    for (const s of signers) {
      const e = evidence.find((x) => x.event === 'signed' && x.signerId === String(s.id));
      const v = s.status === 'signed' ? evidenceVerdict(e, { signatureHash: s.signature_hash, documentHash: input.documentHash }) : null;
      if (doc.y > doc.page.height - 170) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(9.4).text(`${s.step}. ${s.name}${s.role_label ? ` — ${s.role_label}` : ''}`, X, doc.y + 4, { width: W });
      if (s.status !== 'signed') { doc.font('Helvetica-Oblique').fontSize(8.6).text(s.status === 'rejected' ? 'Recusou a assinatura.' : 'Assinatura não realizada.', X, doc.y, { width: W }); continue; }
      line('CPF', mask(s.cpf)); line('Data e hora da assinatura', when(s.signed_at));
      line('Autenticação', e?.authMethod ? METHOD[e.authMethod] ?? e.authMethod : 'Não registrada em evidência (assinatura anterior ao procedimento de evidências)');
      line('Declaração aceita', e?.consentVersion ? `versão ${e.consentVersion}` : 'Não registrada em evidência (procedimento anterior)');
      line('Hash da assinatura', s.signature_hash ?? '—', true);
      if (e) { line('Evidência nº', `${e.seq} (procedimento ${e.procedure}), gravada em ${when(e.recordedAt)}`); line('Hash da evidência', e.payloadHash, true); line('Encadeamento', e.chainHash, true); line('Assinatura do servidor', e.signature === 'valida' ? `válida (Ed25519, chave ${e.keyId})` : e.signature === 'ausente' ? 'ausente (evidência gravada sem chave do servidor)' : 'INVÁLIDA'); }
      doc.font('Helvetica-Bold').fontSize(8.6).fillColor(v?.level === 'falha' ? '#a12a1f' : '#1f6b45').text(`Resultado: ${v?.text ?? ''}`, X, doc.y + 1, { width: W }); doc.fillColor('#000');
    }
    const events = evidence.filter((e) => e.event !== 'signed');
    if (events.length) {
      h('3. Eventos da solicitação');
      for (const e of events) line(`#${e.seq} ${e.event}`, `${when(e.recordedAt)} — ${e.payloadHashOk && e.chainOk ? 'íntegro e encadeado' : 'NÃO CONFERE'}`);
    }

    h(`${events.length ? 4 : 3}. Método e limites`);
    doc.font('Helvetica').fontSize(8.2).text([
      'Hash SHA-256: resumo do conteúdo; qualquer alteração do conteúdo muda o hash. Hash não é assinatura digital.',
      'Evidência: registro em JSON canônico gravado na mesma transação da assinatura, encadeado aos registros anteriores (hash do anterior + hash do atual) e protegido no banco de dados contra alteração e exclusão.',
      `Assinatura do servidor: Ed25519 sobre o texto da evidência, com chave privada mantida fora do banco de dados${key ? ` (chave atual ${key.keyId}, publicada em /api/public/evidence-key)` : ''}. Demonstra que o registro foi produzido pela plataforma e não foi alterado depois; não é certificado ICP-Brasil.`,
      'Data e hora: relógio do servidor, gravadas em UTC e exibidas no horário de Brasília. Não há carimbo de tempo emitido por autoridade certificadora.',
      'Assinaturas anteriores a novembro de 2026 não têm evidência assinada: são conferidas apenas pelos registros (nenhum controle é atribuído a elas retroativamente).',
      `Fundamentação: ${LEGAL_BASIS}`
    ].join('\n\n'), X, doc.y, { width: W, lineGap: 1 });

    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(7.6).fillColor('#444').text(`Relatório gerado em ${when(generatedAt)} a partir dos registros existentes nesse momento. Ele não é um registro contemporâneo das assinaturas: as provas são os registros e evidências nele referidos, conferíveis pela verificação pública e pelo pacote de evidências.`, X, doc.y, { width: W });
    doc.font('Helvetica').fontSize(7.6).text('Este PDF é uma apresentação dos registros: para afastar qualquer alteração dele, confira os hashes acima na verificação pública (QR Code) ou valide o pacote de evidências com a chave pública da plataforma.', X, doc.y + 3, { width: W });
    doc.font('Courier').fontSize(7).text(`Referência dos dados: ${sha256(JSON.stringify({ code: input.code, generatedAt, evidence: evidence.map((e) => e.chainHash) }))}`, X, doc.y + 3, { width: W });
    doc.end();
  });
}
