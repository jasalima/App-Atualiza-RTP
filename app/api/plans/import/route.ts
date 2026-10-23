import crypto from 'node:crypto';
import { z } from 'zod';
import { requireProject, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';
import { putPrivateObject } from '@/lib/storage';
import { extractDocument, identifyScholar, structurePlan } from '@/server/services/document';
import { parseValidity, type Schedule } from '@/server/services/schedule';

const accepted=new Set(['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const MAX_BYTES=20*1024*1024;

type FileResult={file:string;status:'extracted'|'unidentified'|'ambiguous'|'rejected';message?:string;scholarId?:string;scholarName?:string;planId?:string;version?:number;itemCount?:number;scheduled?:number};

// Each file is processed on its own: one unreadable or unidentified document
// does not discard the rest of the batch.
export async function POST(request:Request){
  try{
    const form=await request.formData(),projectId=z.string().uuid().parse(form.get('projectId'));
    const chosen=form.get('scholarId')?z.string().uuid().parse(form.get('scholarId')):null;
    const session=await requireProject(projectId,true),files=form.getAll('files').filter((x):x is File=>x instanceof File);
    if(!files.length)return Response.json({error:'Selecione ao menos um arquivo.'},{status:400});
    if(files.length>30)return Response.json({error:'Envie no máximo 30 arquivos por lote.'},{status:413});
    const scholars=(await sql`SELECT id,full_name FROM scholars WHERE project_id=${projectId}::uuid AND deleted_at IS NULL`) as {id:string;full_name:string}[];
    if(chosen&&!scholars.some(s=>s.id===chosen))return Response.json({error:'Bolsista não pertence ao projeto.'},{status:404});
    const results:FileResult[]=[];
    for(const file of files){
      if(!accepted.has(file.type)){results.push({file:file.name,status:'rejected',message:file.name.toLowerCase().endsWith('.doc')?'Arquivo .doc legado: salve como .docx e reenvie.':'Formato não aceito. Envie PDF ou DOCX.'});continue}
      if(file.size>MAX_BYTES){results.push({file:file.name,status:'rejected',message:'O arquivo passa de 20 MB.'});continue}
      const buffer=Buffer.from(await file.arrayBuffer());
      let text:string,schedule:Schedule|null;
      try{({text,schedule}=await extractDocument(buffer,file.type))}catch{results.push({file:file.name,status:'rejected',message:'Não foi possível ler o texto do documento.'});continue}
      if(text.trim().length<40){results.push({file:file.name,status:'rejected',message:'O documento não contém texto extraível (pode ser uma digitalização).'});continue}
      const match=chosen?{status:'found' as const,scholar:scholars.find(s=>s.id===chosen)!}:identifyScholar(text,scholars);
      if(match.status!=='found'){results.push({file:file.name,status:match.status==='none'?'unidentified':'ambiguous',message:match.status==='none'?'Nenhum bolsista cadastrado foi encontrado no texto.':`Mais de um bolsista citado: ${match.names.join(', ')}.`});continue}
      const scholarId=match.scholar.id,structured=structurePlan(text,schedule),validity=parseValidity(text);
      const sha=crypto.createHash('sha256').update(buffer).digest('hex'),extension=file.name.split('.').pop()?.replace(/[^a-z0-9]/gi,'').toLowerCase()||'bin';
      const key=`${projectId}/${scholarId}/${crypto.randomUUID()}.${extension}`;
      await putPrivateObject(key,buffer,file.type);
      // One transaction per file: document, new plan version, items and audit entry
      // are stored together or not at all, so a failure never leaves a half-imported plan.
      const documentId=crypto.randomUUID(),planId=crypto.randomUUID();
      const items=Object.entries(structured.items).flatMap(([type,list])=>list.map((item)=>({type,...item})));
      await sql.transaction(tx=>[
        tx`INSERT INTO documents(id,project_id,scholar_id,kind,original_name,mime_type,size_bytes,storage_key,sha256,extracted_text,extraction_status,created_by) VALUES(${documentId}::uuid,${projectId}::uuid,${scholarId}::uuid,'individual_work_plan',${file.name},${file.type},${file.size},${key},${sha},${text},'extracted',${session.user.id})`,
        tx`INSERT INTO work_plans(id,project_id,scholar_id,document_id,version,raw_extraction)
           SELECT ${planId}::uuid,${projectId}::uuid,${scholarId}::uuid,${documentId}::uuid,coalesce(max(version),0)+1,${JSON.stringify({items:structured.items,schedule,validity})}::jsonb FROM work_plans WHERE scholar_id=${scholarId}::uuid`,
        tx`UPDATE work_plans SET status='replaced' WHERE scholar_id=${scholarId}::uuid AND id<>${planId}::uuid AND status<>'replaced'`,
        ...items.map((item,order)=>tx`INSERT INTO plan_items(work_plan_id,project_id,scholar_id,item_type,title,description,source_reference,sort_order,scheduled_months,starts_on,ends_on) VALUES(${planId}::uuid,${projectId}::uuid,${scholarId}::uuid,${item.type},${item.title},${item.description},${JSON.stringify({...item.source_reference,file:file.name})}::jsonb,${order},${item.scheduled_months}::text[],${item.starts_on}::date,${item.ends_on}::date)`),
        tx`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${session.user.id},${projectId}::uuid,'import','work_plan',${planId},jsonb_build_object('file',${file.name}::text,'sha256',${sha}::text,'storage','neon-object-storage'))`
      ]);
      const version=await sql`SELECT version FROM work_plans WHERE id=${planId}::uuid`;
      results.push({file:file.name,status:'extracted',scholarId,scholarName:match.scholar.full_name,planId,version:Number(version[0].version),itemCount:items.length,scheduled:items.filter((i)=>i.scheduled_months.length).length});
    }
    return Response.json(results,{status:results.some(r=>r.status==='extracted')?201:422});
  }catch(error){return routeError(error)}
}
