import { z } from 'zod';
import { requireProject, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';

export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params,body=z.object({content:z.any(),changeSummary:z.string().default('Revisão manual')}).parse(await request.json());
    const reports=await sql`SELECT project_id,current_version FROM reports WHERE id=${id}::uuid AND deleted_at IS NULL`;
    if(!reports[0])return Response.json({error:'Relatório não encontrado.'},{status:404});
    const session=await requireProject(String(reports[0].project_id),true),next=Number(reports[0].current_version)+1;
    await sql.transaction(tx=>[
      tx`INSERT INTO report_versions(report_id,version,content,change_summary,created_by) VALUES(${id}::uuid,${next},${JSON.stringify(body.content)}::jsonb,${body.changeSummary},${session.user.id})`,
      tx`UPDATE reports SET current_version=${next},status='draft' WHERE id=${id}::uuid`,
      tx`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${session.user.id},${String(reports[0].project_id)}::uuid,'revise','report',${id},jsonb_build_object('version',${next}::int))`
    ]);
    return Response.json({version:next});
  }catch(error){return routeError(error)}
}

// Logical deletion: the report leaves every list but stays stored with its versions
// and audit trail, and its number remains taken (numbers are never reused).
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params,body=z.object({reason:z.string().trim().min(5,'Informe o motivo da exclusão.')}).parse(await request.json().catch(()=>({})));
    const reports=await sql`SELECT project_id,number FROM reports WHERE id=${id}::uuid AND deleted_at IS NULL`;
    if(!reports[0])return Response.json({error:'Relatório não encontrado.'},{status:404});
    const session=await requireProject(String(reports[0].project_id),true);
    await sql.transaction(tx=>[
      tx`UPDATE reports SET deleted_at=now() WHERE id=${id}::uuid`,
      tx`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${session.user.id},${String(reports[0].project_id)}::uuid,'delete','report',${id},jsonb_build_object('number',${String(reports[0].number)}::text,'reason',${body.reason}::text))`
    ]);
    return Response.json({deleted:true});
  }catch(error){return routeError(error)}
}
