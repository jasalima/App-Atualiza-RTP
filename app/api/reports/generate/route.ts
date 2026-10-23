import { z } from 'zod';
import { requireProject, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';
import { loadReportInput } from '@/lib/report-input';
import { nextRtpNumber, rtpYear } from '@/lib/rtp-number';
import { generateReport, validateReport } from '@/server/services/report';

// The number is assigned here, never taken from the client: one sequence per
// project and year shared by every scholar (see migration 005).
const schema=z.object({projectId:z.string().uuid(),scholarId:z.string().uuid(),periodStart:z.string(),periodEnd:z.string(),issuedOn:z.string(),lengthMode:z.enum(['concise','standard','detailed']).default('standard')});

export async function POST(request:Request){
  try{
    const body=schema.parse(await request.json());
    const session=await requireProject(body.projectId,true);
    if(body.periodEnd<body.periodStart)return Response.json({error:'O período final é anterior ao inicial.'},{status:400});
    const year=rtpYear(body.issuedOn);
    // Concurrent generations may pick the same number; the unique index rejects
    // the second one, which retries with the next number.
    for(let attempt=0;attempt<5;attempt++){
      const used=(await sql`SELECT number FROM reports WHERE project_id=${body.projectId}::uuid`).map((r)=>String(r.number));
      const number=nextRtpNumber(used,year);
      const input=await loadReportInput({...body,number});
      if(!input)return Response.json({error:'Projeto ou bolsista não encontrado.'},{status:404});
      const full={...input,lengthMode:body.lengthMode},generated=generateReport(full),findings=validateReport(generated.content,full);
      const content=JSON.stringify(generated.content),traceability=JSON.stringify(generated.traceability),validationJson=JSON.stringify(findings);
      try{
        const rows=await sql`
          WITH new_report AS (
            INSERT INTO reports(project_id,scholar_id,number,period_start,period_end,issued_on,length_mode,created_by)
            VALUES(${body.projectId}::uuid,${body.scholarId}::uuid,${number},${body.periodStart}::date,${body.periodEnd}::date,${body.issuedOn}::date,${body.lengthMode},${session.user.id}) RETURNING *
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
        if((error as {code?:string}).code!=='23505')throw error;
      }
    }
    return Response.json({error:'Não foi possível reservar um número de RTP. Tente novamente.'},{status:409});
  }catch(error){return routeError(error)}
}
