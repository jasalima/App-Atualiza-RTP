import { z } from 'zod';
import { createHash } from 'node:crypto';
import { requireProject } from './authorize';
import { sql } from './db';
import { loadTravel, travelFile } from './travel';
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
export async function loadDocumentSource(input: z.infer<typeof documentRequest>) {
  const session = await requireProject(input.projectId);
  const notFound = () => Object.assign(new Error('Documento não encontrado neste projeto.'), { status: 404 });
  const checkScholar = (scholarId: unknown, createdBy?: unknown) => {
    if (session.role === 'scholar' && (!session.scholarId || scholarId !== session.scholarId) && createdBy !== session.user.id) throw Object.assign(new Error('Você só pode enviar documentos do seu próprio vínculo.'), { status: 403 });
  };
  if (input.kind === 'travel') {
    if (input.format === 'original') throw Object.assign(new Error('Escolha PDF ou DOCX para o relatório de viagem.'), { status: 400 });
    const { beneficiary } = await loadTravel(input.projectId, input.sourceId);
    const format = input.format;
    return { session, version: null, label: 'Formulário 26 — relatório de viagem', makeFile: () => travelFile(beneficiary, format) };
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
