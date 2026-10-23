import crypto from 'node:crypto';
import { requireProject, routeError } from '@/lib/authorize';
import { signedDownloadUrl, signedUploadUrl } from '@/lib/storage';

export async function POST(request:Request){
  try{
    const body=await request.json();
    if(!body.projectId)return Response.json({error:'Projeto obrigatório.'},{status:400});
    const session=await requireProject(String(body.projectId));
    if(body.operation==='download'){
      if(typeof body.key!=='string'||!body.key.startsWith(`${body.projectId}/`))return Response.json({error:'Chave inválida.'},{status:400});
      return Response.json({url:await signedDownloadUrl(body.key),expiresIn:300});
    }
    const ext=String(body.fileName||'').split('.').pop()?.replace(/[^a-z0-9]/gi,'').toLowerCase()||'bin';
    const key=`${body.projectId}/${session.user.id}/${crypto.randomUUID()}.${ext}`;
    return Response.json({key,url:await signedUploadUrl(key,String(body.contentType||'application/octet-stream')),expiresIn:300});
  }catch(error){return routeError(error)}
}
