import { z } from 'zod';
import { requireProject } from './authorize';
import { sql } from './db';
import { travelDocx, travelPdf, type TravelBeneficiary } from '../server/services/travel-export';

export const travelQuery = z.object({ projectId: z.string().uuid(), scholarId: z.string().uuid(), format: z.enum(['pdf', 'docx']) });
export async function loadTravel(projectId: string, scholarId: string) {
  const session = await requireProject(projectId);
  if (session.role === 'scholar' && session.scholarId !== scholarId) throw Object.assign(new Error('Você só pode gerar o próprio termo.'), { status: 403 });
  const [row] = await sql`SELECT s.full_name,s.role_area,s.phone,s.email,p.title FROM scholars s JOIN projects p ON p.id=s.project_id
    WHERE s.id=${scholarId}::uuid AND s.project_id=${projectId}::uuid AND s.deleted_at IS NULL AND p.deleted_at IS NULL`;
  if (!row) throw Object.assign(new Error('Beneficiário não encontrado neste projeto.'), { status: 404 });
  const beneficiary: TravelBeneficiary = { name: String(row.full_name), role: String(row.role_area), phone: String(row.phone), email: String(row.email), project: String(row.title) };
  return { session, beneficiary };
}
export async function travelFile(beneficiary: TravelBeneficiary, format: 'pdf' | 'docx') {
  return { buffer: await (format === 'pdf' ? travelPdf(beneficiary) : travelDocx(beneficiary)), mime: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: `formulario-26-${beneficiary.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 90)}.${format}` };
}
export function travelError(error: unknown) {
  if (error instanceof z.ZodError) return Response.json({ error: 'Confira os campos informados.' }, { status: 400 });
  const e = error as { status?: number; message?: string };
  return Response.json({ error: e.status ? e.message : 'Não foi possível concluir a operação. Verifique a configuração e tente novamente.' }, { status: e.status || 500 });
}
export function sameOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw Object.assign(new Error('Origem da solicitação inválida.'), { status: 403 });
}
