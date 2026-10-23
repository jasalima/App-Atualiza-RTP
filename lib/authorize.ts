import { auth } from './auth';
import { sql } from './db';

export async function requireProject(projectId:string,manage=false){
  const {data:session}=await auth.getSession();
  if(!session?.user)throw Object.assign(new Error('Autenticação necessária.'),{status:401});
  const rows=await sql`SELECT role,scholar_id FROM user_project_access
    WHERE auth_user_id=${session.user.id}
      AND (project_id=${projectId}::uuid OR role='admin')
    ORDER BY (role='admin') DESC
    LIMIT 1`;
  if(!rows.length||manage&&!['admin','coordinator'].includes(String(rows[0].role)))throw Object.assign(new Error('Acesso negado.'),{status:403});
  return {user:session.user,role:String(rows[0].role),scholarId:rows[0].scholar_id as string|null};
}

export function routeError(error:unknown){
  const e=error as {message?:string;status?:number};
  console.error(error);
  return Response.json({error:e.message||'Erro interno.'},{status:e.status||500});
}
