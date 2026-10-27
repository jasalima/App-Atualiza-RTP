import { z } from 'zod';
import { requireProject } from '../../../lib/authorize';
import { sameOrigin, travelError } from '../../../lib/travel';
import { connectivityConfig, evolutionForProject, saveConnectivity } from '../../../lib/connectivity-config';
import { ownWhatsApp, provisionProjectWhatsApp, provisionWhatsApp } from '../../../lib/whatsapp-connections';
const projectSchema = z.string().uuid();
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const projectId = projectSchema.parse(new URL(request.url).searchParams.get('projectId'));
    const session = await requireProject(projectId);
    const result = { configured: false, instance: '', state: 'not_created', stateError: '', code: '', provisionAvailable: false, serverUrl: '', configurationSource: '' };
    try {
      const config = await connectivityConfig(projectId);
      result.provisionAvailable = Boolean(config.url && config.key);
      result.configurationSource = config.source;
      if (session.role !== 'scholar') result.serverUrl = config.url;
      if (!result.provisionAvailable) { result.code = 'CONFIG_MISSING'; result.stateError = 'O servidor WhatsApp ainda não foi configurado. A coordenação pode configurá-lo nesta página.'; }
      else {
        const connection = await ownWhatsApp(projectId, session.user.id);
        if (connection) {
          result.instance = connection.instance;
          result.state = await (await evolutionForProject(projectId)).state(connection.instance, connection.token);
          result.configured = result.state === 'open';
        }
      }
    } catch (error) {
      result.state = 'unavailable';
      const e = error as { code?: string; providerStatus?: number };
      result.code = e.code || (e.providerStatus === 401 || e.providerStatus === 403 ? 'INSTANCE_AUTH_FAILED' : 'PROVIDER_UNAVAILABLE');
      result.stateError = result.code === 'INSTANCE_KEY_UNREADABLE' ? 'A chave da sua conexão precisa ser sincronizada. Clique em Reconectar meu WhatsApp.' : result.code === 'CONFIG_KEY_UNREADABLE' ? 'A configuração protegida precisa ser salva novamente pela coordenação neste ambiente.' : 'Não foi possível confirmar a conexão com o servidor WhatsApp. Tente novamente.';
    }
    return Response.json(result, { headers });
  } catch (error) { return travelError(error); }
}
export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    const body = z.object({ projectId: projectSchema, serverUrl: z.url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; }, 'Informe uma URL HTTPS válida.'), apiKey: z.string().trim().min(1).max(1000) }).parse(await request.json());
    const { user } = await requireProject(body.projectId, true);
    await saveConnectivity(body.projectId, user.id, body.serverUrl.replace(/\/$/, ''), body.apiKey);
    return Response.json({ success: true }, { headers });
  } catch (error) { return travelError(error); }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = z.object({ projectId: projectSchema, action: z.enum(['provision', 'provisionProject', 'connect']) }).parse(await request.json());
    const { user } = await requireProject(body.projectId, body.action === 'provisionProject');
    if (body.action === 'provisionProject') {
      const results = await provisionProjectWhatsApp(body.projectId);
      return Response.json({ total: results.length, prepared: results.filter(r => !r.error).length, failed: results.filter(r => r.error).length }, { headers });
    }
    if (body.action === 'provision') return Response.json(await provisionWhatsApp(body.projectId, user.id), { headers });
    const connection = await ownWhatsApp(body.projectId, user.id);
    if (!connection) return Response.json({ error: 'Crie sua conexão individual primeiro.' }, { status: 409, headers });
    const provider = await evolutionForProject(body.projectId);
    if (await provider.state(connection.instance, connection.token) === 'open') return Response.json({ connected: true, qr: null }, { headers });
    return Response.json(await provider.connect(connection.instance, connection.token), { headers });
  } catch (error) { return travelError(error); }
}
