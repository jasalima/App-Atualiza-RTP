import crypto from 'node:crypto';
import { z } from 'zod';
import { requireProject, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';
import { putPrivateObject } from '@/lib/storage';
import { extractBuffer, structurePlan } from '@/server/services/document';

const accepted=new Set(['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

export async function POST(request:Request){
  try{
    const form=await request.formData(),projectId=z.string().uuid().parse(form.get('projectId')),scholarId=z.string().uuid().parse(form.get('scholarId'));
    const session=await requireProject(projectId,true),files=form.getAll('files').filter((x):x is File=>x instanceof File);
    if(!files.length)return Response.json({error:'Selecione ao menos um arquivo.'},{status:400});
    const scholar=await sql`SELECT 1 FROM scholars WHERE id=${scholarId}::uuid AND project_id=${projectId}::uuid`;
    if(!scholar.length)return Response.json({error:'Bolsista não pertence ao projeto.'},{status:404});
    const imported=[];
    for(const file of files){
      if(!accepted.has(file.type))return Response.json({error:`Formato não permitido: ${file.name}`},{status:415});
      if(file.size>20*1024*1024)return Response.json({error:`Arquivo excede 20 MB: ${file.name}`},{status:413});
      const buffer=Buffer.from(await file.arrayBuffer()),sha=crypto.createHash('sha256').update(buffer).digest('hex'),extension=file.name.split('.').pop()?.replace(/[^a-z0-9]/gi,'').toLowerCase()||'bin';
      const key=`${projectId}/${scholarId}/${crypto.randomUUID()}.${extension}`;
      const text=await extractBuffer(buffer,file.type),structured=structurePlan(text);
      await putPrivateObject(key,buffer,file.type);
      const documents=await sql`INSERT INTO documents(project_id,scholar_id,kind,original_name,mime_type,size_bytes,storage_key,sha256,extracted_text,extraction_status,created_by) VALUES(${projectId}::uuid,${scholarId}::uuid,'individual_work_plan',${file.name},${file.type},${file.size},${key},${sha},${text},'extracted',${session.user.id}) RETURNING id`;
      const versionRows=await sql`SELECT coalesce(max(version),0)+1 next FROM work_plans WHERE scholar_id=${scholarId}::uuid`;
      await sql`UPDATE work_plans SET status='replaced' WHERE scholar_id=${scholarId}::uuid AND status<>'replaced'`;
      const plans=await sql`INSERT INTO work_plans(project_id,scholar_id,document_id,version,raw_extraction) VALUES(${projectId}::uuid,${scholarId}::uuid,${String(documents[0].id)}::uuid,${Number(versionRows[0].next)},${JSON.stringify(structured)}::jsonb) RETURNING id,version`;
      let order=0;
      for(const [type,items] of Object.entries(structured.items))for(const item of items)await sql`INSERT INTO plan_items(work_plan_id,project_id,scholar_id,item_type,title,description,source_reference,sort_order) VALUES(${String(plans[0].id)}::uuid,${projectId}::uuid,${scholarId}::uuid,${type},${item.title},${item.description},${JSON.stringify(item.source_reference)}::jsonb,${order++})`;
      await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${session.user.id},${projectId}::uuid,'import','work_plan',${String(plans[0].id)},jsonb_build_object('file',${file.name},'sha256',${sha},'storage','neon-object-storage'))`;
      imported.push({id:plans[0].id,version:plans[0].version,file:file.name,status:'extracted',itemCount:order});
    }
    return Response.json(imported,{status:201});
  }catch(error){return routeError(error)}
}
