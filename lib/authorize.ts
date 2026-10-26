import { auth } from './auth';
import { sql } from './db';

export async function requireUser(){
  const {data:session}=await auth.getSession();
  if(!session?.user)throw Object.assign(new Error('Autenticação necessária.'),{status:401});
  const [account]=await sql`SELECT must_change_password,revoked_at FROM managed_users WHERE auth_user_id=${session.user.id}`;
  if(account?.revoked_at)throw Object.assign(new Error('Esta conta foi revogada.'),{status:403});
  return {user:session.user,mustChangePassword:Boolean(account?.must_change_password)};
}

export async function requireAdmin(){
  const {user,mustChangePassword}=await requireUser();
  if(mustChangePassword)throw Object.assign(new Error('Troque a senha temporária antes de continuar.'),{status:428});
  const [access]=await sql`SELECT 1 FROM user_project_access WHERE auth_user_id=${user.id} AND role='admin' LIMIT 1`;
  if(!access)throw Object.assign(new Error('Acesso restrito à administração.'),{status:403});
  return user;
}

export async function requireProject(projectId:string,manage=false){
  const {user,mustChangePassword}=await requireUser();
  if(mustChangePassword)throw Object.assign(new Error('Troque a senha temporária antes de continuar.'),{status:428});
  const rows=await sql`SELECT role,scholar_id FROM user_project_access
    WHERE auth_user_id=${user.id}
      AND (project_id=${projectId}::uuid OR role='admin')
    ORDER BY (role='admin') DESC
    LIMIT 1`;
  if(!rows.length||manage&&!['admin','coordinator'].includes(String(rows[0].role)))throw Object.assign(new Error('Acesso negado.'),{status:403});
  return {user,role:String(rows[0].role),scholarId:rows[0].scholar_id as string|null};
}

export function routeError(error:unknown){
  const e=error as {message?:string;status?:number};
  console.error(error);
  return Response.json({error:e.message||'Erro interno.'},{status:e.status||500});
}
