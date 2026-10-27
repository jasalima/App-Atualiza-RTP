import { z } from 'zod';
import { requireProject } from '../../../../lib/authorize';
import { sameOrigin, travelError } from '../../../../lib/travel';
import { ownWhatsApp, provisionProjectWhatsApp, provisionWhatsApp } from '../../../../lib/whatsapp-connections';
import { Evolution } from '../../../../server/services/evolution';
const projectSchema = z.string().uuid();
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const projectId = projectSchema.parse(new URL(request.url).searchParams.get('projectId'));
    const { user } = await requireProject(projectId);
    const connection = await ownWhatsApp(projectId, user.id);
    let state = 'not_created', stateError = '';
    if (connection) {
      try { state = await new Evolution().state(connection.instance, connection.token); }
      catch { state = 'unavailable'; stateError = 'Não foi possível consultar o WhatsApp. Tente novamente.'; }
    }
    return Response.json({ configured: state === 'open', instance: connection?.instance || '', state, stateError, provisionAvailable: Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = z.object({ projectId: projectSchema, action: z.enum(['provision', 'provisionProject', 'connect']) }).parse(await request.json());
    const { user } = await requireProject(body.projectId, body.action === 'provisionProject');
    if (body.action === 'provisionProject') {
      const results = await provisionProjectWhatsApp(body.projectId);
      return Response.json({ total: results.length, prepared: results.filter(r => !r.error).length, failed: results.filter(r => r.error).length });
    }
    if (body.action === 'provision') return Response.json(await provisionWhatsApp(body.projectId, user.id));
    const connection = await ownWhatsApp(body.projectId, user.id);
    if (!connection) return Response.json({ error: 'Crie sua conexão individual primeiro.' }, { status: 409 });
    const provider = new Evolution();
    if (await provider.state(connection.instance, connection.token) === 'open') return Response.json({ connected: true, qr: null });
    return Response.json(await provider.connect(connection.instance, connection.token), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
