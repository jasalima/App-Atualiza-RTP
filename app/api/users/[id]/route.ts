import { z } from 'zod';
import { requireAdmin, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';

const input=z.object({action:z.enum(['revoke','restore'])});

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  try {
    const admin=await requireAdmin();
    const {id}=await params;
    if(id===admin.id)throw Object.assign(new Error('A conta administrativa em uso não pode revogar a si própria.'),{status:400});
    const parsed=input.safeParse(await request.json());
    if(!parsed.success)throw Object.assign(new Error('Ação inválida.'),{status:400});
    const [target]=await sql`SELECT auth_user_id,revoked_at FROM managed_users WHERE auth_user_id=${id}`;
    if(!target)throw Object.assign(new Error('Usuário não encontrado.'),{status:404});
    const revoke=parsed.data.action==='revoke';
    await sql.transaction([
      revoke
        ? sql`UPDATE managed_users SET revoked_at=now() WHERE auth_user_id=${id}`
        : sql`UPDATE managed_users SET revoked_at=NULL WHERE auth_user_id=${id}`,
      sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata)
          VALUES(${admin.id},NULL,${revoke?'revoke_user':'restore_user'},'managed_users',${id},'{}'::jsonb)`,
    ]);
    return Response.json({success:true},{headers:{'Cache-Control':'no-store'}});
  } catch(error) { return routeError(error); }
}
