import { z } from 'zod';
import { requireAdmin, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';
import { createAuthAccount, temporaryPassword } from '@/lib/users';

const input=z.object({
  name:z.string().trim().min(3).max(120),
  email:z.email().trim().toLowerCase(),
  role:z.enum(['coordinator','scholar']),
  projectId:z.uuid(),
  scholarId:z.uuid().nullable().optional(),
}).superRefine((value,ctx)=>{
  if(value.role==='scholar'&&!value.scholarId)ctx.addIssue({code:'custom',path:['scholarId'],message:'Selecione o bolsista associado.'});
});

export async function GET(){
  try {
    await requireAdmin();
    const rows=await sql`
      SELECT u.auth_user_id,u.name,u.email,u.must_change_password,u.revoked_at,u.created_at,
             a.role,a.project_id,a.scholar_id,p.title AS project_title,s.full_name AS scholar_name
      FROM managed_users u
      LEFT JOIN LATERAL (
        SELECT x.role,x.project_id,x.scholar_id
        FROM user_project_access x WHERE x.auth_user_id=u.auth_user_id
        ORDER BY CASE x.role WHEN 'admin' THEN 0 WHEN 'coordinator' THEN 1 ELSE 2 END
        LIMIT 1
      ) a ON true
      LEFT JOIN projects p ON p.id=a.project_id
      LEFT JOIN scholars s ON s.id=a.scholar_id
      ORDER BY u.name`;
    return Response.json(rows.map((row)=>({
      authUserId:row.auth_user_id,name:row.name,email:row.email,role:row.role,
      projectId:row.project_id,projectTitle:row.project_title,scholarId:row.scholar_id,
      scholarName:row.scholar_name,mustChangePassword:row.must_change_password,
      revoked:Boolean(row.revoked_at),createdAt:row.created_at,
    })),{headers:{'Cache-Control':'no-store'}});
  } catch(error) { return routeError(error); }
}

export async function POST(request:Request){
  let createdUserId:string|undefined;
  try {
    const admin=await requireAdmin();
    const parsed=input.safeParse(await request.json());
    if(!parsed.success)throw Object.assign(new Error(parsed.error.issues[0]?.message||'Dados inválidos.'),{status:400});
    const value=parsed.data;
    const [project]=await sql`SELECT id FROM projects WHERE id=${value.projectId}::uuid AND deleted_at IS NULL`;
    if(!project)throw Object.assign(new Error('Projeto não encontrado.'),{status:404});
    if(value.role==='scholar'){
      const [scholar]=await sql`SELECT id FROM scholars WHERE id=${value.scholarId}::uuid AND project_id=${value.projectId}::uuid AND deleted_at IS NULL`;
      if(!scholar)throw Object.assign(new Error('O bolsista não pertence ao projeto selecionado.'),{status:400});
    }
    const password=temporaryPassword();
    createdUserId=await createAuthAccount(new URL(request.url).origin,{email:value.email,password,name:value.name});
    await sql.transaction([
      sql`INSERT INTO managed_users(auth_user_id,name,email,must_change_password,created_by)
          VALUES(${createdUserId},${value.name},${value.email},true,${admin.id})`,
      sql`INSERT INTO user_project_access(auth_user_id,project_id,scholar_id,role)
          VALUES(${createdUserId},${value.projectId}::uuid,${value.scholarId??null}::uuid,${value.role}::user_role)`,
      value.role==='scholar'
        ? sql`UPDATE scholars SET auth_user_id=${createdUserId} WHERE id=${value.scholarId}::uuid`
        : sql`SELECT 1`,
      sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata)
          VALUES(${admin.id},${value.projectId}::uuid,'create_user','managed_users',${createdUserId},
            jsonb_build_object('email',${value.email}::text,'role',${value.role}::text))`,
    ]);
    return Response.json({userId:createdUserId,temporaryPassword:password},{status:201,headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    // Compensate an Auth-first signup when the application transaction fails.
    // The guard prevents removing an account whose managed record was committed.
    if(createdUserId){
      try{
        await sql`DELETE FROM neon_auth."user" auth_user
          WHERE auth_user.id=${createdUserId}::uuid
            AND NOT EXISTS (
              SELECT 1 FROM managed_users managed
              WHERE managed.auth_user_id=${createdUserId}
            )`;
      }catch{/* Preserve the original creation error. */}
    }
    return routeError(error);
  }
}
