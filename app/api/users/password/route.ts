import { z } from 'zod';
import { auth } from '@/lib/auth';
import { requireUser, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';
import { authFailure } from '@/lib/users';

const input=z.object({
  currentPassword:z.string().min(8),
  newPassword:z.string().min(12,'A nova senha deve ter pelo menos 12 caracteres.')
    .regex(/[a-z]/,'Inclua uma letra minúscula.')
    .regex(/[A-Z]/,'Inclua uma letra maiúscula.')
    .regex(/[0-9]/,'Inclua um número.')
    .regex(/[^A-Za-z0-9]/,'Inclua um caractere especial.'),
});

export async function POST(request:Request){
  try {
    const {user}=await requireUser();
    const parsed=input.safeParse(await request.json());
    if(!parsed.success)throw Object.assign(new Error(parsed.error.issues[0]?.message||'Senha inválida.'),{status:400});
    if(parsed.data.currentPassword===parsed.data.newPassword)throw Object.assign(new Error('A nova senha deve ser diferente da temporária.'),{status:400});
    const result=await auth.changePassword({...parsed.data,revokeOtherSessions:true});
    const failure=authFailure(result.error);
    if(failure){
      if(result.error?.status===400||result.error?.status===401)throw Object.assign(new Error('A senha temporária informada está incorreta.'),{status:400});
      throw failure;
    }
    await sql.transaction([
      sql`UPDATE managed_users SET must_change_password=false WHERE auth_user_id=${user.id}`,
      sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata)
          VALUES(${user.id},NULL,'change_password','managed_users',${user.id},'{}'::jsonb)`,
    ]);
    return Response.json({success:true},{headers:{'Cache-Control':'no-store'}});
  } catch(error) { return routeError(error); }
}
