import { requireUser } from './authorize';
import { sql } from './db';

import { GRANTABLE, MODULES, PROFILE_MODULES, type ModuleKey } from './modules-catalog';
export { GRANTABLE, MODULES, PROFILE_MODULES, type ModuleKey };

/** Enabled modules of an account (project-scoped grants). */
export async function grantsOf(userId: string) {
  const rows = await sql`SELECT g.module,g.project_id,p.title FROM user_modules g JOIN projects p ON p.id=g.project_id WHERE g.auth_user_id=${userId} AND p.deleted_at IS NULL ORDER BY p.title`;
  return rows.map((r) => ({ module: String(r.module) as ModuleKey, projectId: String(r.project_id), projectTitle: String(r.title) }));
}

/**
 * Session allowed to use a module in a project: by profile (admin, coordination) or by a grant.
 * Unlike requireProject, a signature-only account passes when the module was enabled for it.
 */
export async function requireModule(projectId: string, module: ModuleKey) {
  const { user, mustChangePassword } = await requireUser();
  if (mustChangePassword) throw Object.assign(new Error('Troque a senha temporária antes de continuar.'), { status: 428 });
  const [access] = await sql`SELECT role,scholar_id FROM user_project_access WHERE auth_user_id=${user.id} AND (project_id=${projectId}::uuid OR role='admin')
    ORDER BY (role='admin') DESC LIMIT 1`;
  if (!access) throw Object.assign(new Error('Acesso negado.'), { status: 403 });
  const role = String(access.role);
  if (!PROFILE_MODULES[role]?.includes(module)) {
    const [grant] = await sql`SELECT 1 FROM user_modules WHERE auth_user_id=${user.id} AND project_id=${projectId}::uuid AND module=${module}`;
    if (!grant) throw Object.assign(new Error(`O módulo ${MODULES[module].label} não está habilitado para a sua conta. Solicite à administração.`), { status: 403 });
  }
  return { user, role, scholarId: access.scholar_id as string | null };
}
