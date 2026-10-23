import { requireProject, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';
import { toDocx, toPdf } from '@/server/services/export';
import type { ReportContent } from '@/server/types';

export async function GET(_request:Request,{params}:{params:Promise<{id:string;format:string}>}){
  try{
    const {id,format}=await params;if(!['docx','pdf'].includes(format))return Response.json({error:'Formato inválido.'},{status:400});
    const rows=await sql`SELECT r.project_id,r.number,r.status,rv.content FROM reports r JOIN report_versions rv ON rv.report_id=r.id AND rv.version=r.current_version WHERE r.id=${id}::uuid`;
    if(!rows[0])return Response.json({error:'Relatório não encontrado.'},{status:404});
    const session=await requireProject(String(rows[0].project_id));
    const file=format==='docx'?await toDocx(rows[0].content as ReportContent):await toPdf(rows[0].content as ReportContent);
    // Only an approved report becomes "exported"; drafts can be previewed as files without changing status.
    if(rows[0].status==='approved')await sql.transaction(tx=>[
      tx`UPDATE reports SET status='exported' WHERE id=${id}::uuid`,
      tx`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${session.user.id},${String(rows[0].project_id)}::uuid,'export','report',${id},jsonb_build_object('format',${format}))`
    ]);
    return new Response(new Uint8Array(file),{headers:{'Content-Type':format==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf','Content-Disposition':`attachment; filename="RTP-${String(rows[0].number).replace(/[^a-z0-9-]/gi,'_')}.${format}"`}});
  }catch(error){return routeError(error)}
}
