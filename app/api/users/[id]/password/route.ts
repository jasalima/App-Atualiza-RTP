import { auth } from '@/lib/auth';
import { requireAdmin, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';
import { temporaryPassword } from '@/lib/users';

const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

// Password reset by the system administrator: a new temporary password, shown once, that the
// person must change at the next login. Every open session of that account is ended. The
// administrator never sees or chooses the final password, and the action is audited.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    if (id === admin.id) throw fail('Para trocar a sua própria senha, use Trocar senha no seu perfil.', 400);
    const [target] = await sql`SELECT auth_user_id,name,email FROM managed_users WHERE auth_user_id=${id}`;
    if (!target) throw fail('Usuário não encontrado.', 404);
    const [isAdmin] = await sql`SELECT 1 FROM user_project_access WHERE auth_user_id=${id} AND role='admin' LIMIT 1`;
    if (isAdmin) throw fail('A senha de outra conta administrativa não pode ser redefinida por aqui.', 403);

    const password = temporaryPassword();
    const result = await auth.admin.setUserPassword({ userId: id, newPassword: password });
    if (result.error) {
      const status = result.error.status;
      if (status === 401 || status === 403) throw fail('O Neon Auth recusou a redefinição: a sua conta precisa ter o papel de administrador no Neon Auth.', 403);
      throw Object.assign(fail('Não foi possível redefinir a senha no Neon Auth. Tente novamente.', 502), { cause: result.error });
    }
    // Ends the sessions opened with the old password (best effort: the password already changed).
    const revoked = await auth.admin.revokeUserSessions({ userId: id }).then((r) => !r.error, () => false);
    await sql.transaction([
      sql`UPDATE managed_users SET must_change_password=true WHERE auth_user_id=${id}`,
      sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata)
          VALUES(${admin.id},NULL,'reset_password','managed_users',${id},jsonb_build_object('sessionsRevoked',${revoked}::boolean))`,
    ]);
    return Response.json({ email: String(target.email), temporaryPassword: password, sessionsRevoked: revoked }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return routeError(error); }
}
