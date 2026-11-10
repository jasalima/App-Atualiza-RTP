import { z } from 'zod';
import { sql } from './db';
import { readPrivateObject } from './storage';
import { fullTravelFill, signerCandidates, verifyLink } from './signatures';
import { beneficiaryOf, travelFile, travelFileName, travelReportById } from './travel';
import { emailConfig, EmailError, sendEmail, type EmailAttachment } from '../server/services/resend';

// Signed Formulário 26 reports e-mailed to the FAPTO analyst through Resend, with a message
// model per project. Replies go to whoever sent it.

export const DEFAULT_SUBJECT = 'PCDP — Relatório de viagem assinado — {{beneficiarios}} — {{periodo}}';
export const DEFAULT_BODY = `Prezada colaboradora,

Encaminho, em anexo, {{quantidade}} relatório(s) de viagem (Formulário 26) do projeto {{projeto}}, assinado(s) eletronicamente:

{{relatorios}}

A autenticidade de cada documento pode ser conferida pelo link de verificação indicado acima.

Atenciosamente,
{{remetente}}
{{funcao_remetente}}`;
/** Placeholders accepted in the model, shown in the configuration screen. */
export const PLACEHOLDERS = {
  projeto: 'Projeto/convênio', beneficiarios: 'Nome(s) do(s) beneficiário(s)', periodo: 'Período(s) da viagem', destino: 'Destino(s)',
  os: 'Nº OS FAPTO da(s) diária(s)', quantidade: 'Quantidade de relatórios', relatorios: 'Lista dos relatórios com destino, período, Nº OS FAPTO e link de verificação',
  remetente: 'Seu nome', funcao_remetente: 'Sua função no projeto', data_envio: 'Data do envio'
} as const;

const emails = z.array(z.string().trim().toLowerCase().email('Informe e-mails válidos.')).max(10);
export const emailSettingsInput = z.object({
  projectId: z.string().uuid(), recipients: emails.min(1, 'Informe ao menos um destinatário.'), cc: emails.default([]),
  subject: z.string().trim().min(3).max(300), body: z.string().trim().min(10).max(8000)
});
export const sendInput = z.object({
  projectId: z.string().uuid(), reportIds: z.array(z.string().uuid()).min(1).max(10),
  subject: z.string().trim().min(3).max(300).optional(), body: z.string().trim().min(10).max(8000).optional(), preview: z.boolean().default(false)
});

const fail = (message: string, status: number) => Object.assign(new Error(message), { status });
const br = (d: string | null) => d ? d.slice(0, 10).split('-').reverse().join('/') : '';
export const render = (template: string, vars: Record<string, string>) => template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, k: string) => k in vars ? vars[k] : all);
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Plain text to simple HTML: paragraphs, line breaks and clickable links. */
export const toHtml = (text: string) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2933">${text.split(/\n{2,}/).map((p) =>
  `<p style="margin:0 0 12px">${escape(p).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;

export async function emailSettings(projectId: string) {
  const [row] = await sql`SELECT recipients,cc,subject_template,body_template,updated_at FROM project_email_settings WHERE project_id=${projectId}::uuid`;
  const { from, ready } = emailConfig();
  return {
    recipients: (row?.recipients ?? []) as string[], cc: (row?.cc ?? []) as string[],
    subject: row ? String(row.subject_template) : DEFAULT_SUBJECT, body: row ? String(row.body_template) : DEFAULT_BODY,
    saved: Boolean(row), provider: { ready, from }, placeholders: PLACEHOLDERS
  };
}
export async function saveEmailSettings(input: z.infer<typeof emailSettingsInput>, userId: string) {
  await sql`INSERT INTO project_email_settings(project_id,recipients,cc,subject_template,body_template,updated_by)
    VALUES(${input.projectId}::uuid,${input.recipients},${input.cc},${input.subject},${input.body},${userId})
    ON CONFLICT(project_id) DO UPDATE SET recipients=EXCLUDED.recipients,cc=EXCLUDED.cc,subject_template=EXCLUDED.subject_template,
      body_template=EXCLUDED.body_template,updated_by=EXCLUDED.updated_by,updated_at=now()`;
}

const MAX_BYTES = 28 * 1024 * 1024; // Resend accepts 40 MB per e-mail after base64 encoding.

/** Signed reports, their attachments and the message, ready to preview or send. */
async function compose(input: z.infer<typeof sendInput>, user: { id: string; email?: string | null; name?: string | null }) {
  const settings = await emailSettings(input.projectId);
  const ids = [...new Set(input.reportIds)];
  const requests = await sql`SELECT DISTINCT ON (source_id) source_id,status,verification_code,archived_document_id FROM signature_requests
    WHERE project_id=${input.projectId}::uuid AND source_kind='travel' AND source_id = ANY(${ids}::uuid[]) ORDER BY source_id, created_at DESC`;
  const reports = await Promise.all(ids.map(async (id) => {
    const report = await travelReportById(input.projectId, id);
    const request = requests.find((r) => String(r.source_id) === id);
    if (request?.status !== 'completed') throw fail(`O relatório de ${report.scholarName} ainda não foi assinado por todos. Só relatórios assinados seguem para a FAPTO.`, 409);
    return { report, request, beneficiary: await beneficiaryOf(input.projectId, report.scholarId) };
  }));
  const [project] = await sql`SELECT title,agreement FROM projects WHERE id=${input.projectId}::uuid`;
  const me = (await signerCandidates(input.projectId)).find((p) => p.authUserId === user.id);
  const period = (r: (typeof reports)[number]['report']) => r.departureDate ? (r.returnDate && r.returnDate !== r.departureDate ? `${br(r.departureDate)} a ${br(r.returnDate)}` : br(r.departureDate)) : 'sem data';
  const unique = (xs: string[]) => [...new Set(xs.filter(Boolean))].join('; ');
  const vars = {
    projeto: String(project?.agreement || '').trim() || String(project?.title ?? ''),
    beneficiarios: unique(reports.map((x) => x.beneficiary.name)), periodo: unique(reports.map((x) => period(x.report))),
    destino: unique(reports.map((x) => x.report.destination)), quantidade: String(reports.length),
    os: unique(reports.map((x) => x.report.osNumber)),
    relatorios: reports.map((x, i) => `${i + 1}. ${x.beneficiary.name} — ${x.report.destination || 'destino não informado'} — ${period(x.report)}${x.report.osNumber ? ` OS ${x.report.osNumber}` : ''}\n   Verificação: ${verifyLink(String(x.request!.verification_code))}`).join('\n'),
    remetente: String(me?.name || user.name || user.email || '').replace(/\s+/g, ' ').trim(), funcao_remetente: String(me?.roleLabel ?? '').replace(/\s+/g, ' ').trim(),
    data_envio: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  };
  const subject = render(input.subject ?? settings.subject, vars).replace(/\s+/g, ' ').trim();
  const text = render(input.body ?? settings.body, vars).replace(/\n{3,}/g, '\n\n').trim();
  return { settings, reports, subject, text };
}

/** The archived signed PDF (the one the signers saw completed) or, without it, a fresh render. */
async function attachment(projectId: string, x: Awaited<ReturnType<typeof compose>>['reports'][number]): Promise<EmailAttachment> {
  const fill = await fullTravelFill(x.report);
  const filename = travelFileName(x.beneficiary.name, 'pdf', fill);
  if (x.request?.archived_document_id) {
    const [doc] = await sql`SELECT storage_key FROM documents WHERE id=${x.request.archived_document_id}::uuid AND project_id=${projectId}::uuid AND deleted_at IS NULL`;
    if (doc) return { filename, content: await readPrivateObject(String(doc.storage_key), MAX_BYTES) };
  }
  const file = await travelFile(x.beneficiary, 'pdf', fill);
  return { filename, content: file.buffer };
}

export async function sendTravelToFapto(input: z.infer<typeof sendInput>, user: { id: string; email?: string | null; name?: string | null }) {
  const { settings, reports, subject, text } = await compose(input, user);
  const previous = await sql`SELECT max(created_at) AS at FROM email_deliveries WHERE project_id=${input.projectId}::uuid AND status='sent' AND source_ids && ${reports.map((x) => x.report.id)}::uuid[]`;
  const lastSentAt = previous[0]?.at ? new Date(previous[0].at as string).toISOString() : null;
  if (input.preview) return { preview: true as const, to: settings.recipients, cc: settings.cc, from: settings.provider.from, ready: settings.provider.ready, subject, body: text, lastSentAt,
    missingOs: reports.filter((x) => !x.report.osNumber).map((x) => x.beneficiary.name),
    files: reports.map((x) => travelFileName(x.beneficiary.name, 'pdf', { departure: x.report.departureDate, signatures: { status: 'completed' } as never })) };

  if (!settings.recipients.length) throw fail('Configure o e-mail da colaboradora da FAPTO em "Modelo de e-mail" antes de enviar.', 409);
  const { from, ready } = emailConfig();
  if (!ready) throw new EmailError('O envio de e-mail ainda não foi configurado: cadastre RESEND_API_KEY e EMAIL_FROM na Vercel.', 409);
  const files = await Promise.all(reports.map((x) => attachment(input.projectId, x)));
  if (files.reduce((s, f) => s + f.content.length, 0) > MAX_BYTES) throw fail('Os anexos passam do limite de um e-mail. Envie menos relatórios de cada vez.', 413);

  const ids = reports.map((x) => x.report.id);
  const [delivery] = await sql`INSERT INTO email_deliveries(project_id,source_kind,source_ids,recipients,cc,subject,status,sent_by)
    VALUES(${input.projectId}::uuid,'travel',${ids}::uuid[],${settings.recipients},${settings.cc},${subject},'sending',${user.id}) RETURNING id`;
  try {
    const sent = await sendEmail({ from, to: settings.recipients, cc: settings.cc, replyTo: user.email ?? undefined, subject, text, html: toHtml(text), attachments: files }, `fapto-travel/${delivery.id}`);
    await sql`UPDATE email_deliveries SET status='sent',provider_id=${sent.id} WHERE id=${delivery.id}::uuid`;
    await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id},${input.projectId}::uuid,'email_fapto','email_delivery',${String(delivery.id)},${JSON.stringify({ reports: ids, to: settings.recipients, providerId: sent.id })}::jsonb)`;
    return { sent: true as const, to: settings.recipients, id: String(delivery.id) };
  } catch (error) {
    await sql`UPDATE email_deliveries SET status='failed',error=${(error as Error).message.slice(0, 500)} WHERE id=${delivery.id}::uuid`;
    throw error;
  }
}
