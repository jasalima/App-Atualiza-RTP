import { z } from 'zod';
import { requireProject, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';

// Returns an approved or exported report to draft so it can be edited again.
// The approval is withdrawn and the reason is kept in the audit trail.
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params,body=z.object({reason:z.string().trim().min(5,'Informe o motivo da reabertura.')}).parse(await request.json().catch(()=>({})));
    const reports=await sql`SELECT project_id,status FROM reports WHERE id=${id}::uuid AND deleted_at IS NULL`;
    if(!reports[0])return Response.json({error:'Relatório não encontrado.'},{status:404});
    const session=await requireProject(String(reports[0].project_id),true);
    await sql.transaction(tx=>[
      tx`UPDATE reports SET status='draft',approved_at=NULL,approved_by=NULL WHERE id=${id}::uuid`,
      tx`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${session.user.id},${String(reports[0].project_id)}::uuid,'reopen','report',${id},jsonb_build_object('from',${String(reports[0].status)}::text,'reason',${body.reason}::text))`
    ]);
    return Response.json({status:'draft'});
  }catch(error){return routeError(error)}
}
