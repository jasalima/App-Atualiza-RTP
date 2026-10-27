import { z } from 'zod';
import { createHash } from 'node:crypto';
import { requireProject } from './authorize';
import { sql } from './db';
import { loadTravel, loadTravelReport, travelFile, travelFill } from './travel';
import { readPrivateObject } from './storage';
import { toDocx, toPdf } from '../server/services/export';
import type { ReportContent } from '../server/types';

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const documentRequest = z.object({ projectId: z.string().uuid(), sourceId: z.string().uuid(), kind: z.enum(['travel', 'rtp', 'document']), format: z.enum(['pdf', 'docx', 'original']) });
export const safeFileName = (name: string) => name.replace(/[\x00-\x1f\x7f/\\"<>:|?*]/g, '_').slice(0, 180) || 'documento';
export function recipientNumber(value: string) {
  if (!/^\+?[\d\s().-]+$/.test(value.trim())) throw Object.assign(new Error('Informe um telefone válido com DDI e DDD.'), { status: 400 });
  const number = value.replace(/\D/g, '');
  if (!/^[1-9]\d{9,14}$/.test(number)) throw Object.assign(new Error('Informe o telefone com DDI e DDD (ex.: 5563999999999).'), { status: 400 });
  return number;
}
type Session = Awaited<ReturnType<typeof requireProject>>;
const ROLE_LABEL: Record<string, string> = { admin: 'Administração do sistema', coordinator: 'Coordenação do projeto', scholar: 'Bolsista' };
/** Who signs the message: their member record (by link or e-mail), else the account name and access role. */
export async function sender(session: Session, projectId: string) {
  const user = session.user as { name?: string; email?: string }, email = String(user.email ?? '');
  const [member] = await sql`SELECT full_name,role_area FROM scholars WHERE project_id=${projectId}::uuid AND deleted_at IS NULL
    AND (id=${session.scholarId}::uuid OR (${email}::text<>'' AND lower(email)=lower(${email}::text))) ORDER BY (id=${session.scholarId}::uuid) DESC NULLS LAST LIMIT 1`;
  return {
    name: String(member?.full_name ?? '').trim() || String(user.name ?? '').trim() || email || 'Equipe do projeto',
    role: String(member?.role_area ?? '').trim() || ROLE_LABEL[session.role] || 'Equipe do projeto'
  };
}
/** WhatsApp text that goes with a travel accountability report. */
export async function accountabilityMessage(session: Session, projectId: string, label: string) {
  const from = await sender(session, projectId);
  return [
    `Olá, essa é uma mensagem automática, favor assinar o documento anexo ${label} e devolver em pdf.`,
    'Lembramos que é necessário inserir o relatório de fotos conforme consta da seção "registro fotográfico".',
    '',
    'Atenciosamente,',
    `*${from.name}*`,
    from.role
  ].join('\n');
}
export async function loadDocumentSource(input: z.infer<typeof documentRequest>) {
  const session = await requireProject(input.projectId);
  const notFound = () => Object.assign(new Error('Documento não encontrado neste projeto.'), { status: 404 });
  const checkScholar = (scholarId: unknown, createdBy?: unknown) => {
    if (session.role === 'scholar' && (!session.scholarId || scholarId !== session.scholarId) && createdBy !== session.user.id) throw Object.assign(new Error('Você só pode enviar documentos do seu próprio vínculo.'), { status: 403 });
  };
  if (input.kind === 'travel') {
    if (input.format === 'original') throw Object.assign(new Error('Escolha PDF ou DOCX para o relatório de viagem.'), { status: 400 });
    const format = input.format;
    // A filled travel report (travel_reports id) or, as before, the blank form of a member (scholar id).
    const [filled] = await sql`SELECT 1 FROM travel_reports WHERE id=${input.sourceId}::uuid AND project_id=${input.projectId}::uuid AND deleted_at IS NULL`;
    if (filled) {
      const { beneficiary, report } = await loadTravelReport(input.projectId, input.sourceId);
      const label = `Formulário 26 — Relatório de Viagem${report.destination ? ` a ${report.destination}` : ''}`;
      return { session, version: null, label, caption: () => accountabilityMessage(session, input.projectId, label), makeFile: () => travelFile(beneficiary, format, travelFill(report)) };
    }
    const { beneficiary } = await loadTravel(input.projectId, input.sourceId);
    const label = 'Formulário 26 — Relatório de Viagem';
    return { session, version: null, label, caption: () => accountabilityMessage(session, input.projectId, label), makeFile: () => travelFile(beneficiary, format) };
  }
  if (input.kind === 'rtp') {
    if (input.format === 'original') throw Object.assign(new Error('Escolha PDF ou DOCX para o RTP.'), { status: 400 });
    const [report] = await sql`SELECT r.id,r.scholar_id,r.number,r.status,r.current_version,rv.content FROM reports r
      JOIN projects p ON p.id=r.project_id AND p.deleted_at IS NULL
      JOIN report_versions rv ON rv.report_id=r.id AND rv.version=r.current_version
      WHERE r.id=${input.sourceId}::uuid AND r.project_id=${input.projectId}::uuid AND r.deleted_at IS NULL`;
    if (!report) throw notFound();
    checkScholar(report.scholar_id);
    const format = input.format;
    return { session, version: Number(report.current_version), label: `RTP ${report.number}${['approved','exported'].includes(String(report.status)) ? '' : ' — prévia'}`, makeFile: async () => ({ buffer: await (format === 'pdf' ? toPdf(report.content as ReportContent) : toDocx(report.content as ReportContent)), mime: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: safeFileName(`RTP-${String(report.number).replace(/\//g, '-')}.${format}`) }) };
  }
  if (input.format !== 'original') throw Object.assign(new Error('Arquivos cadastrados são enviados no formato original.'), { status: 400 });
  const [document] = await sql`SELECT d.* FROM documents d JOIN projects p ON p.id=d.project_id AND p.deleted_at IS NULL WHERE d.id=${input.sourceId}::uuid AND d.project_id=${input.projectId}::uuid`;
  if (!document) throw notFound();
  checkScholar(document.scholar_id, document.created_by);
  if (!String(document.storage_key).startsWith(`${input.projectId}/`)) throw notFound();
  if (Number(document.size_bytes) > MAX_DOCUMENT_BYTES) throw Object.assign(new Error('O documento excede o limite de 20 MB para envio.'), { status: 413 });
  return { session, version: null, label: String(document.original_name), makeFile: async () => {
    const buffer = await readPrivateObject(String(document.storage_key), MAX_DOCUMENT_BYTES);
    if (createHash('sha256').update(buffer).digest('hex') !== document.sha256) throw Object.assign(new Error('O arquivo armazenado não corresponde ao documento cadastrado.'), { status: 409 });
    return { buffer, mime: String(document.mime_type), filename: safeFileName(String(document.original_name)) };
  } };
}
