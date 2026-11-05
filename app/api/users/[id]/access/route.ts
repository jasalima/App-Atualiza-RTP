import { z } from 'zod';
import { requireAdmin, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';
import { GRANTABLE, MODULES, PROFILE_MODULES, type ModuleKey } from '@/lib/modules';

const input = z.object({
  projectId: z.uuid(),
  modules: z.array(z.enum(GRANTABLE as [ModuleKey, ...ModuleKey[]])).max(20),
  scholarId: z.uuid().nullable()
});

// Administration edits what an account may use in a project: extra modules and the member
// record it represents. A member link requires the same e-mail on both sides.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const parsed = input.safeParse(await request.json());
    if (!parsed.success) throw Object.assign(new Error(parsed.error.issues[0]?.message || 'Dados inválidos.'), { status: 400 });
    const { projectId, scholarId } = parsed.data;
    const [access] = await sql`SELECT a.role,a.scholar_id,u.email FROM user_project_access a JOIN neon_auth."user" u ON u.id::text=a.auth_user_id
      WHERE a.auth_user_id=${id} AND a.project_id=${projectId}::uuid`;
    if (!access) throw Object.assign(new Error('A conta não tem acesso a este projeto.'), { status: 404 });
    const role = String(access.role);
    // Dependencies come along (the ata sender needs the atas and an own connection); what the profile already includes is not stored.
    const modules = [...new Set(parsed.data.modules.flatMap((m) => [m, ...(MODULES[m].requires ?? [])]))].filter((m) => GRANTABLE.includes(m) && !PROFILE_MODULES[role]?.includes(m));
    const email = String(access.email).toLowerCase(), previous = access.scholar_id ? String(access.scholar_id) : null;
    if (role === 'coordinator' && scholarId) throw Object.assign(new Error('Contas de coordenação não são vinculadas a um membro.'), { status: 400 });
    let member: Record<string, unknown> | undefined;
    if (scholarId) {
      [member] = await sql`SELECT id,full_name,email,auth_user_id FROM scholars WHERE id=${scholarId}::uuid AND project_id=${projectId}::uuid AND deleted_at IS NULL`;
      if (!member) throw Object.assign(new Error('O membro não pertence a este projeto.'), { status: 400 });
      const memberEmail = String(member.email ?? '').trim().toLowerCase();
      if (memberEmail && memberEmail !== email) throw Object.assign(new Error(`O e-mail da conta (${email}) é diferente do e-mail do cadastro de ${member.full_name} (${memberEmail}). Vincule a conta ao próprio membro ou corrija o cadastro.`), { status: 400 });
    }
    const unlinked = previous && previous !== scholarId ? previous : null;
    // Signature slots still pending for the member that was wrongly represented go back to
    // the member's own account (same e-mail), so nobody signs in someone else's name.
    const rebind = unlinked ? sql`UPDATE signature_signers s SET auth_user_id=own.id FROM scholars m, neon_auth."user" own, signature_requests r
        WHERE m.id=${unlinked}::uuid AND lower(own.email)=lower(m.email) AND m.email<>'' AND r.id=s.request_id AND r.status='pending'
          AND s.auth_user_id=${id} AND s.status='pending' AND s.name=m.full_name
          AND NOT EXISTS(SELECT 1 FROM signature_signers x WHERE x.request_id=s.request_id AND x.auth_user_id=own.id::text) RETURNING s.request_id` : sql`SELECT NULL::uuid AS request_id WHERE false`;
    const results = await sql.transaction([
      sql`DELETE FROM user_modules WHERE auth_user_id=${id} AND project_id=${projectId}::uuid`,
      // One number sends the atas of a project: enabling it for this account takes it from anyone else.
      ...(parsed.data.modules.includes('minutes_sender') ? [sql`DELETE FROM user_modules WHERE project_id=${projectId}::uuid AND module='minutes_sender' AND auth_user_id<>${id}`] : [sql`SELECT 1`]),
      ...modules.map((m) => sql`INSERT INTO user_modules(auth_user_id,project_id,module,granted_by) VALUES(${id},${projectId}::uuid,${m},${admin.id})`),
      sql`UPDATE user_project_access SET scholar_id=${scholarId}::uuid WHERE auth_user_id=${id} AND project_id=${projectId}::uuid`,
      sql`UPDATE scholars SET auth_user_id=NULL WHERE auth_user_id=${id} AND project_id=${projectId}::uuid AND id IS DISTINCT FROM ${scholarId}::uuid`,
      scholarId ? sql`UPDATE scholars SET auth_user_id=${id} WHERE id=${scholarId}::uuid AND auth_user_id IS NULL` : sql`SELECT 1`,
      rebind,
      sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${admin.id},${projectId}::uuid,'update_access','managed_users',${id},
        jsonb_build_object('modules',${JSON.stringify(modules)}::jsonb,'scholarId',${scholarId}::text,'previousScholarId',${previous}::text))`
    ]) as unknown as Array<Array<{ request_id: string }>>;
    const moved = results[modules.length + 5] ?? [];
    return Response.json({ saved: true, reboundSignatures: moved.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return routeError(error); }
}
