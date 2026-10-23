import { z } from 'zod';
import { requireProject, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';
import { isoDate, loadReportInput } from '@/lib/report-input';
import { otherReportTexts } from '@/lib/other-reports';
import { generateDistinct } from '@/server/services/report';
import type { ReportContent } from '@/server/types';

const sections=['results','comparison','additional'] as const;

// Rebuilds one section from the current plan and execution records, keeping the
// reviewer's edits in every other section. The result is a new immutable version.
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params,{section}=z.object({section:z.enum(sections)}).parse(await request.json());
    const rows=await sql`SELECT r.*,rv.content FROM reports r JOIN report_versions rv ON rv.report_id=r.id AND rv.version=r.current_version WHERE r.id=${id}::uuid AND r.deleted_at IS NULL`;
    const report=rows[0];
    if(!report)return Response.json({error:'Relatório não encontrado.'},{status:404});
    const session=await requireProject(String(report.project_id),true);
    const iso=(d:unknown)=>d instanceof Date?isoDate(d):String(d).slice(0,10);
    const input=await loadReportInput({projectId:String(report.project_id),scholarId:String(report.scholar_id),periodStart:iso(report.period_start),periodEnd:iso(report.period_end),number:String(report.number),issuedOn:iso(report.issued_on)});
    if(!input)return Response.json({error:'Bolsista não encontrado.'},{status:404});
    const fresh=generateDistinct({...input,lengthMode:report.length_mode},await otherReportTexts(String(report.project_id),id)),current=report.content as ReportContent,next=Number(report.current_version)+1;
    const content:ReportContent={...current,sections:{...current.sections,[section]:fresh.content.sections[section]},pending:fresh.content.pending};
    await sql.transaction(tx=>[
      tx`INSERT INTO report_versions(report_id,version,content,traceability,change_summary,created_by) VALUES(${id}::uuid,${next},${JSON.stringify(content)}::jsonb,${JSON.stringify(fresh.traceability)}::jsonb,${`Seção regenerada: ${section}`},${session.user.id})`,
      tx`UPDATE reports SET current_version=${next},status='draft' WHERE id=${id}::uuid`,
      tx`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${session.user.id},${String(report.project_id)}::uuid,'regenerate','report',${id},jsonb_build_object('section',${section}::text,'version',${next}::int))`
    ]);
    return Response.json({version:next,content});
  }catch(error){return routeError(error)}
}
