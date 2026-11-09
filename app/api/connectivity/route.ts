import { z } from 'zod';
import { sql } from '../../../lib/db';
import { requireProject } from '../../../lib/authorize';
import { requireModule } from '../../../lib/modules';
import { sameOrigin, travelError } from '../../../lib/travel';
import { connectivityConfig, evolutionForProject, saveConnectivity } from '../../../lib/connectivity-config';
import { ownWhatsApp, provisionProjectWhatsApp, provisionWhatsApp, replaceWhatsApp, sessionBroken } from '../../../lib/whatsapp-connections';
const projectSchema = z.string().uuid();
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const projectId = projectSchema.parse(new URL(request.url).searchParams.get('projectId'));
    // Own connection: by profile or by the enabled module "Conexão WhatsApp" (e.g. a signature-only member).
    const session = await requireModule(projectId, 'whatsapp');
    const result = { configured: false, instance: '', state: 'not_created', stateError: '', code: '', provisionAvailable: false, serverUrl: '', configurationSource: '' };
    try {
      const config = await connectivityConfig(projectId);
      result.provisionAvailable = Boolean(config.url && config.key);
      result.configurationSource = config.source;
      if (session.role === 'admin' || session.role === 'coordinator') result.serverUrl = config.url;
      if (!result.provisionAvailable) { result.code = 'CONFIG_MISSING'; result.stateError = 'O servidor WhatsApp ainda não foi configurado. A coordenação pode configurá-lo nesta página.'; }
      else {
        const connection = await ownWhatsApp(projectId, session.user.id);
        if (connection) {
          result.instance = connection.instance;
          const provider = await evolutionForProject(projectId);
          result.state = await provider.state(connection.instance, connection.token);
          // "open" is not enough: after the device is unlinked on the phone the server keeps
          // reporting it. Only a session that answers counts as connected.
          if (result.state === 'open' && await sessionBroken(projectId, session.user.id)) {
            result.state = 'stale';
            result.stateError = 'A sessão deste WhatsApp foi encerrada no celular ou caiu, embora o servidor ainda a mostre como conectada. Clique em Reconectar meu WhatsApp e escaneie o novo QR Code.';
          }
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
    const body = z.object({ projectId: projectSchema, action: z.enum(['provision', 'provisionProject', 'connect', 'disconnect', 'replace']) }).parse(await request.json());
    const { user } = body.action === 'provisionProject' ? await requireProject(body.projectId, true) : await requireModule(body.projectId, 'whatsapp');
    if (body.action === 'provisionProject') {
      const results = await provisionProjectWhatsApp(body.projectId);
      return Response.json({ total: results.length, prepared: results.filter(r => !r.error).length, failed: results.filter(r => r.error).length }, { headers });
    }
    if (body.action === 'provision') return Response.json(await provisionWhatsApp(body.projectId, user.id), { headers });
    if (body.action === 'replace') {
      const provider = await evolutionForProject(body.projectId);
      const fresh = await replaceWhatsApp(body.projectId, user.id);
      await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${user.id},${body.projectId}::uuid,'whatsapp_connected','whatsapp_connection',${fresh.instance},${JSON.stringify({ replaced: fresh.previous })}::jsonb)`.catch(() => {});
      return Response.json(await provider.connect(fresh.instance, fresh.token), { headers });
    }
    const connection = await ownWhatsApp(body.projectId, user.id);
    if (!connection) return Response.json({ error: 'Crie sua conexão individual primeiro.' }, { status: 409, headers });
    const provider = await evolutionForProject(body.projectId);
    if (body.action === 'disconnect') {
      await provider.logout(connection.instance, connection.token);
      await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${user.id},${body.projectId}::uuid,'whatsapp_disconnect','whatsapp_connection',${connection.instance},'{}'::jsonb)`.catch(() => {});
      return Response.json({ disconnected: true }, { headers });
    }
    if (await provider.state(connection.instance, connection.token) === 'open') {
      if (!(await sessionBroken(body.projectId, user.id))) return Response.json({ connected: true, qr: null }, { headers });
      // Broken session: end it so the server issues a new QR Code.
      await provider.logout(connection.instance, connection.token);
    }
    const result = await provider.connect(connection.instance, connection.token);
    await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${user.id},${body.projectId}::uuid,'whatsapp_connected','whatsapp_connection',${connection.instance},'{}'::jsonb)`.catch(() => {});
    return Response.json(result, { headers });
  } catch (error) { return travelError(error); }
}
