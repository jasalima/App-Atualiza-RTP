import { z } from 'zod';
import { requireProject, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';

// Resolving a finding never edits the report: it records who accepted it and why.
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params,body=z.object({validationId:z.string().uuid(),note:z.string().trim().min(10,'Justifique a resolução com ao menos 10 caracteres.')}).parse(await request.json());
    const reports=await sql`SELECT project_id FROM reports WHERE id=${id}::uuid AND deleted_at IS NULL`;
    if(!reports[0])return Response.json({error:'Relatório não encontrado.'},{status:404});
    const session=await requireProject(String(reports[0].project_id),true);
    const rows=await sql`UPDATE validations SET resolved_at=now(),resolved_by=${session.user.id},resolution_note=${body.note}
      WHERE id=${body.validationId}::uuid AND report_id=${id}::uuid AND resolved_at IS NULL RETURNING *`;
    if(!rows[0])return Response.json({error:'Validação inexistente ou já resolvida.'},{status:404});
    await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${session.user.id},${String(reports[0].project_id)}::uuid,'resolve','validation',${body.validationId},jsonb_build_object('report',${id}::text,'note',${body.note}::text))`;
    return Response.json(rows[0]);
  }catch(error){return routeError(error)}
}
