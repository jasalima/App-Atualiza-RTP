import { sql } from './db';
import { Evolution } from '../server/services/evolution';
import { openCredential, sealCredential } from '../server/services/travel-credentials';

export class ConnectivityError extends Error {
  status = 409;
  constructor(message: string, public code: string) { super(message); }
}
export async function connectivityConfig(projectId: string) {
  const [row] = await sql`SELECT evolution_url,encrypted_api_key FROM project_connectivity_settings WHERE project_id=${projectId}::uuid`;
  if (row) {
    try { return { url: String(row.evolution_url), key: openCredential(String(row.encrypted_api_key), `connectivity:${projectId}`), source: 'project' }; }
    catch { throw new ConnectivityError('A configuração protegida precisa ser salva novamente neste ambiente.', 'CONFIG_KEY_UNREADABLE'); }
  }
  return { url: process.env.EVOLUTION_API_URL || '', key: process.env.EVOLUTION_API_KEY || '', source: 'environment' };
}
export async function evolutionForProject(projectId: string) {
  const config = await connectivityConfig(projectId);
  if (!config.url || !config.key) throw new ConnectivityError('O servidor WhatsApp ainda não foi configurado para este projeto. A coordenação pode configurá-lo em Conectividade.', 'CONFIG_MISSING');
  return new Evolution(config.url, config.key);
}
export async function saveConnectivity(projectId: string, userId: string, url: string, key: string) {
  const provider = new Evolution(url, key);
  await provider.checkCredentials();
  const encrypted = sealCredential(key, `connectivity:${projectId}`);
  await sql`INSERT INTO project_connectivity_settings(project_id,evolution_url,encrypted_api_key,updated_by) VALUES(${projectId}::uuid,${url},${encrypted},${userId})
    ON CONFLICT(project_id) DO UPDATE SET evolution_url=EXCLUDED.evolution_url,encrypted_api_key=EXCLUDED.encrypted_api_key,updated_by=EXCLUDED.updated_by,updated_at=now()`;
}
