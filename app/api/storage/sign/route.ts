import crypto from 'node:crypto';
import { auth } from '@/lib/auth';
import { sql } from '@/lib/db';
import { signedDownloadUrl, signedUploadUrl } from '@/lib/storage';

export async function POST(request:Request){
  const {data:session}=await auth.getSession();
  if(!session?.user)return Response.json({error:'Autenticação necessária.'},{status:401});
  const body=await request.json();
  if(!body.projectId)return Response.json({error:'Projeto obrigatório.'},{status:400});
  const access=await sql`SELECT role FROM user_project_access WHERE auth_user_id=${session.user.id} AND project_id=${body.projectId}::uuid`;
  if(!access.length)return Response.json({error:'Acesso negado.'},{status:403});
  if(body.operation==='download'){
    if(typeof body.key!=='string'||!body.key.startsWith(`${body.projectId}/`))return Response.json({error:'Chave inválida.'},{status:400});
    return Response.json({url:await signedDownloadUrl(body.key),expiresIn:300});
  }
  const ext=String(body.fileName||'').split('.').pop()?.replace(/[^a-z0-9]/gi,'').toLowerCase()||'bin';
  const key=`${body.projectId}/${session.user.id}/${crypto.randomUUID()}.${ext}`;
  return Response.json({key,url:await signedUploadUrl(key,String(body.contentType||'application/octet-stream')),expiresIn:300});
}
