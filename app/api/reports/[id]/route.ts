import { z } from 'zod';
import { requireProject, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';

export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params,body=z.object({content:z.any(),changeSummary:z.string().default('Revisão manual')}).parse(await request.json());
    const reports=await sql`SELECT project_id,current_version FROM reports WHERE id=${id}::uuid`;
    if(!reports[0])return Response.json({error:'Relatório não encontrado.'},{status:404});
    const session=await requireProject(String(reports[0].project_id),true),next=Number(reports[0].current_version)+1;
    await sql.transaction(tx=>[
      tx`INSERT INTO report_versions(report_id,version,content,change_summary,created_by) VALUES(${id}::uuid,${next},${JSON.stringify(body.content)}::jsonb,${body.changeSummary},${session.user.id})`,
      tx`UPDATE reports SET current_version=${next},status='draft' WHERE id=${id}::uuid`,
      tx`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${session.user.id},${String(reports[0].project_id)}::uuid,'revise','report',${id},jsonb_build_object('version',${next}))`
    ]);
    return Response.json({version:next});
  }catch(error){return routeError(error)}
}
