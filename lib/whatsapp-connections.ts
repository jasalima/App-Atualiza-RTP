import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { Evolution, EvolutionError, gesprojectInstance } from '../server/services/evolution';
import { openCredential, sealCredential } from '../server/services/travel-credentials';

export async function ownWhatsApp(projectId: string, userId: string) {
  const [row] = await sql`SELECT instance,api_key FROM project_whatsapp_connections WHERE project_id=${projectId}::uuid AND auth_user_id=${userId}`;
  if (!row || row.instance !== gesprojectInstance(projectId, userId)) return null;
  return { instance: String(row.instance), token: openCredential(String(row.api_key), `${userId}:${projectId}`) };
}
export async function provisionWhatsApp(projectId: string, userId: string) {
  const instance = gesprojectInstance(projectId, userId);
  const encrypted = sealCredential(randomBytes(32).toString('hex'), `${userId}:${projectId}`);
  // Save the key before calling the provider. Retries and concurrent requests
  // reuse the winner's key, including after an uncertain create response.
  await sql`INSERT INTO project_whatsapp_connections(project_id,auth_user_id,instance,api_key) VALUES(${projectId}::uuid,${userId},${instance},${encrypted})
    ON CONFLICT(project_id,auth_user_id) DO UPDATE SET instance=EXCLUDED.instance,api_key=EXCLUDED.api_key,updated_at=now()
    WHERE project_whatsapp_connections.instance<>EXCLUDED.instance`;
  const connection = await ownWhatsApp(projectId, userId);
  if (!connection) throw new Error('Não foi possível reservar a conexão individual.');
  const result = await new Evolution().ensure(connection.instance, connection.token);
  return { instance: connection.instance, created: result.created };
}
export async function provisionProjectWhatsApp(projectId: string) {
  const users = await sql`SELECT DISTINCT a.auth_user_id FROM user_project_access a
    LEFT JOIN managed_users m ON m.auth_user_id=a.auth_user_id
    JOIN projects p ON p.id=${projectId}::uuid AND p.deleted_at IS NULL
    WHERE (a.project_id=p.id OR a.role='admin') AND m.revoked_at IS NULL`;
  const results: Array<{ userId: string; instance?: string; created?: boolean; error?: string }> = [];
  for (const row of users) {
    const userId = String(row.auth_user_id);
    try { results.push({ userId, ...await provisionWhatsApp(projectId, userId) }); }
    catch (error) { results.push({ userId, error: error instanceof EvolutionError ? error.message : 'Não foi possível preparar a conexão.' }); }
  }
  return results;
}
