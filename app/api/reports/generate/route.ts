import { z } from 'zod';
import { requireProject, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';
import { loadReportInput } from '@/lib/report-input';
import { generateReport, validateReport } from '@/server/services/report';

const schema=z.object({projectId:z.string().uuid(),scholarId:z.string().uuid(),periodStart:z.string(),periodEnd:z.string(),number:z.string().min(1),issuedOn:z.string(),lengthMode:z.enum(['concise','standard','detailed']).default('standard')});

export async function POST(request:Request){
  try{
    const body=schema.parse(await request.json());
    const session=await requireProject(body.projectId,true);
    if(body.periodEnd<body.periodStart)return Response.json({error:'O período final é anterior ao inicial.'},{status:400});
    const input=await loadReportInput(body);
    if(!input)return Response.json({error:'Projeto ou bolsista não encontrado.'},{status:404});
    const generated=generateReport(input),findings=validateReport(generated.content,input);
    const content=JSON.stringify(generated.content),traceability=JSON.stringify(generated.traceability),validationJson=JSON.stringify(findings);
    const rows=await sql`
      WITH new_report AS (
        INSERT INTO reports(project_id,scholar_id,number,period_start,period_end,issued_on,length_mode,created_by)
        VALUES(${body.projectId}::uuid,${body.scholarId}::uuid,${body.number},${body.periodStart}::date,${body.periodEnd}::date,${body.issuedOn}::date,${body.lengthMode},${session.user.id}) RETURNING *
      ), new_version AS (
        INSERT INTO report_versions(report_id,version,content,traceability,change_summary,created_by)
        SELECT id,1,${content}::jsonb,${traceability}::jsonb,'Geração inicial',${session.user.id} FROM new_report
      ), new_validations AS (
        INSERT INTO validations(report_id,report_version,severity,code,message,location,source_reference)
        SELECT r.id,1,v.severity::severity,v.code,v.message,v.location,v.source_reference
        FROM new_report r CROSS JOIN jsonb_to_recordset(${validationJson}::jsonb) AS v(severity text,code text,message text,location text,source_reference jsonb)
      ), audit AS (
        INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata)
        SELECT ${session.user.id},project_id,'generate','report',id::text,jsonb_build_object('number',number) FROM new_report
      ) SELECT * FROM new_report`;
    return Response.json({...rows[0],content:generated.content,validations:findings},{status:201});
  }catch(error){
    if((error as {code?:string}).code==='23505')return Response.json({error:'Este bolsista já possui um RTP com esse número.'},{status:409});
    return routeError(error);
  }
}
