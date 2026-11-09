import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { Evolution, EvolutionError, gesprojectInstance } from '../server/services/evolution';
import { openCredential, sealCredential } from '../server/services/travel-credentials';
import { ConnectivityError, evolutionForProject } from './connectivity-config';

/** This account's instance names in a project: the original one, or a replacement (-r + 6 hex). */
export function ownsInstance(projectId: string, userId: string, name: string) {
  const base = gesprojectInstance(projectId, userId);
  return name === base || (name.startsWith(`${base}-r`) && /^[0-9a-f]{6}$/.test(name.slice(base.length + 2)));
}
export async function ownWhatsApp(projectId: string, userId: string) {
  const [row] = await sql`SELECT instance,api_key FROM project_whatsapp_connections WHERE project_id=${projectId}::uuid AND auth_user_id=${userId}`;
  if (!row || !ownsInstance(projectId, userId, String(row.instance))) return null;
  try { return { instance: String(row.instance), token: openCredential(String(row.api_key), `${userId}:${projectId}`) }; }
  catch { throw new ConnectivityError('A chave individual precisa ser sincronizada neste ambiente. Use Reconectar em Conectividade.', 'INSTANCE_KEY_UNREADABLE'); }
}
export async function provisionWhatsApp(projectId: string, userId: string) {
  const provider = await evolutionForProject(projectId);
  const instance = gesprojectInstance(projectId, userId);
  const encrypted = sealCredential(randomBytes(32).toString('hex'), `${userId}:${projectId}`);
  // Save the key before calling the provider. Retries and concurrent requests
  // reuse the winner's key, including after an uncertain create response.
  await sql`INSERT INTO project_whatsapp_connections(project_id,auth_user_id,instance,api_key) VALUES(${projectId}::uuid,${userId},${instance},${encrypted})
    ON CONFLICT(project_id,auth_user_id) DO UPDATE SET instance=EXCLUDED.instance,api_key=EXCLUDED.api_key,updated_at=now()
    WHERE project_whatsapp_connections.instance<>EXCLUDED.instance AND project_whatsapp_connections.instance NOT LIKE ${`${instance}-r%`}`;
  // A replacement connection (see replaceWhatsApp) is kept; recover under the name actually saved.
  const [saved] = await sql`SELECT instance FROM project_whatsapp_connections WHERE project_id=${projectId}::uuid AND auth_user_id=${userId}`;
  const current = saved && ownsInstance(projectId, userId, String(saved.instance)) ? String(saved.instance) : instance;
  let connection;
  try { connection = await ownWhatsApp(projectId, userId); }
  catch (error) {
    if (!(error instanceof ConnectivityError) || error.code !== 'INSTANCE_KEY_UNREADABLE') throw error;
    // Only recover the exact binding already reserved in this application's DB.
    // The provider's administrative key authorizes reading that instance token;
    // no instance is adopted by name supplied from a browser or reconfigured.
    const token = await provider.recoverScopedToken(current);
    const repaired = sealCredential(token, `${userId}:${projectId}`);
    await sql`UPDATE project_whatsapp_connections SET api_key=${repaired},updated_at=now() WHERE project_id=${projectId}::uuid AND auth_user_id=${userId} AND instance=${current}`;
    connection = await ownWhatsApp(projectId, userId);
  }
  if (!connection) throw new Error('Não foi possível reservar a conexão individual.');
  const result = await provider.ensure(connection.instance, connection.token);
  return { instance: connection.instance, created: result.created };
}
export async function provisionProjectWhatsApp(projectId: string) {
  const users = await sql`SELECT DISTINCT a.auth_user_id FROM user_project_access a
    LEFT JOIN managed_users m ON m.auth_user_id=a.auth_user_id
    JOIN projects p ON p.id=${projectId}::uuid AND p.deleted_at IS NULL
    WHERE (a.project_id=p.id OR a.role='admin') AND a.role<>'signer' AND m.revoked_at IS NULL`;
  const results: Array<{ userId: string; instance?: string; created?: boolean; error?: string }> = [];
  for (const row of users) {
    const userId = String(row.auth_user_id);
    try { results.push({ userId, ...await provisionWhatsApp(projectId, userId) }); }
    catch (error) { results.push({ userId, error: error instanceof EvolutionError ? error.message : 'Não foi possível preparar a conexão.' }); }
  }
  return results;
}

/**
 * Number that sends a module's messages in a project: the account enabled as sender (e.g. the
 * person responsible for the atas) when its WhatsApp is connected, otherwise the fallback
 * account (who opened the request). Returns which one was used and why.
 */
export async function moduleSender(projectId: string, module: 'minutes_sender', fallbackUserId: string) {
  const [row] = await sql`SELECT auth_user_id FROM user_modules WHERE project_id=${projectId}::uuid AND module=${module} LIMIT 1`;
  const designated = row ? String(row.auth_user_id) : null;
  const provider = await evolutionForProject(projectId);
  for (const userId of [designated, fallbackUserId].filter((v, i, a): v is string => !!v && a.indexOf(v) === i)) {
    try {
      const connection = await ownWhatsApp(projectId, userId);
      if (connection && await provider.state(connection.instance, connection.token) === 'open') return { userId, connection, provider, designated };
    } catch { /* try the next account */ }
  }
  return { userId: null, connection: null, provider, designated };
}

/**
 * Evolution keeps reporting "open" for a session whose socket died or whose device was removed on
 * the phone. The truth is in this account's own sends: when the latest one failed with a dead
 * session (Connection Closed) and nothing succeeded or reconnected since, the session is broken.
 */
export async function sessionBroken(projectId: string, userId: string) {
  const [row] = await sql`SELECT action, metadata::text AS meta FROM audit_logs
    WHERE user_id=${userId} AND project_id=${projectId}::uuid
      AND action IN ('notify_signer','notify_returned','send_signed','send_document','notify_failed','send_document_failed','dispatch_skipped','whatsapp_disconnect','whatsapp_connected')
    ORDER BY created_at DESC LIMIT 1`;
  return !!row && /connection closed|logged ?out/i.test(String(row.meta ?? '')) && ['notify_failed', 'send_document_failed', 'dispatch_skipped'].includes(String(row.action));
}

/**
 * A session Evolution can neither log out nor delete (dead socket still reported as open) cannot
 * be reused. This account gets a fresh instance under a new name and key; the stuck one is left
 * for the server administrator. Only the caller's own binding changes; nothing else is touched.
 */
export async function replaceWhatsApp(projectId: string, userId: string) {
  const provider = await evolutionForProject(projectId);
  const old = await ownWhatsApp(projectId, userId).catch(() => null);
  if (old) await provider.deleteInstance(old.instance).catch(() => {});
  const instance = `${gesprojectInstance(projectId, userId)}-r${randomBytes(3).toString('hex')}`;
  const token = randomBytes(32).toString('hex');
  await sql`INSERT INTO project_whatsapp_connections(project_id,auth_user_id,instance,api_key) VALUES(${projectId}::uuid,${userId},${instance},${sealCredential(token, `${userId}:${projectId}`)})
    ON CONFLICT(project_id,auth_user_id) DO UPDATE SET instance=EXCLUDED.instance,api_key=EXCLUDED.api_key,updated_at=now()`;
  await provider.ensure(instance, token);
  return { instance, token, previous: old?.instance ?? null };
}
