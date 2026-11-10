import { z } from 'zod';
import { requireProject } from './authorize';
import { sql } from './db';
import { isValidOs, normalizeOs, OS_HINT } from './fapto-os';
import { DEFAULT_DESTINATION, DEFAULT_ORIGIN, travelDocx, travelPdf, type TravelBeneficiary, type TravelFill } from '../server/services/travel-export';

export const travelQuery = z.object({ projectId: z.string().uuid(), scholarId: z.string().uuid(), format: z.enum(['pdf', 'docx']) });
export async function loadTravel(projectId: string, scholarId: string) {
  const session = await requireProject(projectId);
  if (session.role === 'scholar' && session.scholarId !== scholarId) throw Object.assign(new Error('Você só pode gerar o próprio termo.'), { status: 403 });
  return { session, beneficiary: await beneficiaryOf(projectId, scholarId) };
}
/** Beneficiary block of Form 26; callers authorize first. */
export async function beneficiaryOf(projectId: string, scholarId: string) {
  const [row] = await sql`SELECT s.full_name,s.role_area,s.phone,s.email,p.title,p.agreement FROM scholars s JOIN projects p ON p.id=s.project_id
    WHERE s.id=${scholarId}::uuid AND s.project_id=${projectId}::uuid AND s.deleted_at IS NULL AND p.deleted_at IS NULL`;
  if (!row) throw Object.assign(new Error('Beneficiário não encontrado neste projeto.'), { status: 404 });
  const beneficiary: TravelBeneficiary = { name: flat(row.full_name), role: flat(row.role_area), phone: flat(row.phone), email: flat(row.email), project: flat(row.agreement) || flat(row.title) };
  return beneficiary;
}
/** Nº OS FAPTO: optional (older reports), but always in the WEB:99999/2026 format. */
export const osNumberInput = z.string().max(40).transform(normalizeOs).refine((v) => v === '' || isValidOs(v), { message: `Nº OS FAPTO inválido. Use o ${OS_HINT}.` });
export const travelEntry = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')), activity: z.string().max(2000) });
export const travelReportUpdate = z.object({
  origin: z.string().trim().max(160).transform((v) => v || DEFAULT_ORIGIN), destination: z.string().trim().max(160).transform((v) => v || DEFAULT_DESTINATION),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), objective: z.string().max(8000),
  entries: z.array(travelEntry).max(60), status: z.enum(['draft', 'finalized'])
}).refine((v) => !v.departureDate || !v.returnDate || v.returnDate >= v.departureDate, { message: 'O retorno não pode ser anterior à saída.' })
  .refine((v) => v.status === 'draft' || (v.origin && v.destination && v.departureDate && v.returnDate && v.objective.trim()), { message: 'Para concluir, informe origem, destino, saída, retorno e a descrição da viagem.' });

const iso = (d: unknown) => d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d ? String(d).slice(0, 10) : null;
const stamp = (d: unknown) => d instanceof Date ? d.toISOString() : String(d ?? '');
export const travelReportRow = (r: Record<string, unknown>) => ({
  id: String(r.id), projectId: String(r.project_id), scholarId: String(r.scholar_id), scholarName: r.full_name ? String(r.full_name) : undefined,
  osNumber: String(r.os_number ?? ''), origin: String(r.origin ?? ''), destination: String(r.destination ?? ''), departureDate: iso(r.departure_date), returnDate: iso(r.return_date), paymentDate: iso(r.payment_date),
  objective: String(r.objective ?? ''), entries: (r.entries ?? []) as Array<{ date: string; activity: string }>, photos: (r.photos ?? []) as TravelPhoto[], status: String(r.status),
  // ISO strings: String(Date) is not parseable by Postgres and drops the milliseconds.
  createdAt: stamp(r.created_at), updatedAt: stamp(r.updated_at),
  // Only in the project list: latest signature request and last e-mail to the FAPTO.
  ...(r.signature_status !== undefined ? { signatureStatus: r.signature_status ? String(r.signature_status) : null, emailedAt: r.emailed_at ? stamp(r.emailed_at) : null } : {})
});

/** A photo of the "Registro fotográfico" page, stored as JPEG in the private bucket. */
export type TravelPhoto = { key: string; name: string; caption: string; width: number; height: number; size: number };
/** The report row without session checks; callers authorize first. */
export async function travelReportById(projectId: string, reportId: string) {
  const [row] = await sql`SELECT t.*,s.full_name FROM travel_reports t JOIN scholars s ON s.id=t.scholar_id
    WHERE t.id=${reportId}::uuid AND t.project_id=${projectId}::uuid AND t.deleted_at IS NULL`;
  if (!row) throw Object.assign(new Error('Relatório de viagem não encontrado.'), { status: 404 });
  return travelReportRow(row);
}
/** A filled travel report the session may see: scholars only their own. */
export async function loadTravelReport(projectId: string, reportId: string, write = false) {
  const session = await requireProject(projectId);
  const [row] = await sql`SELECT t.*,s.full_name FROM travel_reports t JOIN scholars s ON s.id=t.scholar_id
    WHERE t.id=${reportId}::uuid AND t.project_id=${projectId}::uuid AND t.deleted_at IS NULL`;
  if (!row) throw Object.assign(new Error('Relatório de viagem não encontrado.'), { status: 404 });
  if (session.role === 'scholar' && session.scholarId !== row.scholar_id) throw Object.assign(new Error('Você só pode acessar os próprios relatórios de viagem.'), { status: 403 });
  if (write && session.role === 'scholar' && row.status === 'finalized') throw Object.assign(new Error('Relatório concluído. Peça à coordenação para reabri-lo.'), { status: 409 });
  return { session, beneficiary: await beneficiaryOf(projectId, String(row.scholar_id)), report: travelReportRow(row) };
}
export const travelFill = (r: ReturnType<typeof travelReportRow>): TravelFill => ({ origin: r.origin, destination: r.destination, departure: r.departureDate, returnDate: r.returnDate, payment: r.paymentDate, objective: r.objective, entries: r.entries });

/** PCDP_<beneficiary>_<trip start dd-mm-aaaa>[_assinado].<ext>: ASCII only, so it is safe in headers and archives. */
export function travelFileName(name: string, format: 'pdf' | 'docx', fill?: TravelFill) {
  const who = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 90) || 'beneficiario';
  const date = fill?.departure ? `_${fill.departure.slice(0, 10).split('-').reverse().join('-')}` : '';
  return `PCDP_${who}${date}${fill?.signatures?.status === 'completed' ? '_assinado' : ''}.${format}`;
}
export async function travelFile(beneficiary: TravelBeneficiary, format: 'pdf' | 'docx', fill?: TravelFill) {
  return { buffer: await (format === 'pdf' ? travelPdf(beneficiary, fill) : travelDocx(beneficiary, fill)), mime: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: travelFileName(beneficiary.name, format, fill) };
}
/** Text pasted from spreadsheets brings tabs and line breaks the PDF fonts cannot draw. */
const flat = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
export function travelError(error: unknown) {
  if (error instanceof z.ZodError) return Response.json({ error: 'Confira os campos informados.' }, { status: 400 });
  const e = error as { status?: number; message?: string; code?: string };
  return Response.json({ error: e.status ? e.message : 'Não foi possível concluir a operação. Verifique a configuração e tente novamente.', ...(e.status && typeof e.code === 'string' ? { code: e.code } : {}) }, { status: e.status || 500 });
}
export function sameOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw Object.assign(new Error('Origem da solicitação inválida.'), { status: 403 });
}
