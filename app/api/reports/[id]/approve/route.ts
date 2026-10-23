import { requireProject, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';

export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params,reports=await sql`SELECT project_id FROM reports WHERE id=${id}::uuid`;
    if(!reports[0])return Response.json({error:'Relatório não encontrado.'},{status:404});
    const session=await requireProject(String(reports[0].project_id),true);
    const critical=await sql`SELECT 1 FROM validations WHERE report_id=${id}::uuid AND severity='critical' AND resolved_at IS NULL LIMIT 1`;
    if(critical.length)return Response.json({error:'Resolva as inconsistências críticas antes da aprovação.'},{status:409});
    await sql.transaction(tx=>[
      tx`UPDATE reports SET status='approved',approved_at=now(),approved_by=${session.user.id} WHERE id=${id}::uuid`,
      tx`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id) VALUES(${session.user.id},${String(reports[0].project_id)}::uuid,'approve','report',${id})`
    ]);
    return Response.json({status:'approved'});
  }catch(error){return routeError(error)}
}
