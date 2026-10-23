import { sql } from './db';

type Params={projectId:string;scholarId:string;periodStart:string;periodEnd:string;number:string;issuedOn:string};

// Every query is pinned to one scholar: this is the boundary that keeps one
// scholar's plan and execution out of another scholar's report.
export async function loadReportInput(p:Params){
  const [projectRows,scholarRows,planRows,planItems,executions,previousReports]=await Promise.all([
    sql`SELECT * FROM projects WHERE id=${p.projectId}::uuid AND deleted_at IS NULL`,
    sql`SELECT * FROM scholars WHERE id=${p.scholarId}::uuid AND project_id=${p.projectId}::uuid AND deleted_at IS NULL`,
    sql`SELECT status,functional_identity FROM work_plans WHERE scholar_id=${p.scholarId}::uuid AND status<>'replaced' ORDER BY version DESC LIMIT 1`,
    sql`SELECT pi.* FROM plan_items pi JOIN work_plans w ON w.id=pi.work_plan_id WHERE pi.scholar_id=${p.scholarId}::uuid AND w.status<>'replaced' ORDER BY pi.sort_order`,
    sql`SELECT * FROM execution_records WHERE scholar_id=${p.scholarId}::uuid AND deleted_at IS NULL AND period_start<=${p.periodEnd}::date AND period_end>=${p.periodStart}::date`,
    // Earlier reports of the same scholar, so the text can state continuity.
    sql`SELECT number,period_start,period_end FROM reports WHERE scholar_id=${p.scholarId}::uuid AND deleted_at IS NULL AND period_end<${p.periodStart}::date ORDER BY period_end DESC`
  ]);
  if(!projectRows[0]||!scholarRows[0])return null;
  return {project:dates(projectRows[0]),scholar:dates(scholarRows[0]),planStatus:planRows[0]?.status as string|undefined,functionalIdentity:(planRows[0]?.functional_identity as string|undefined)||undefined,planItems:planItems.map(dates),executions:executions.map(dates),previousReports:previousReports.map(dates) as Array<{number:string;period_start:string;period_end:string}>,number:p.number,periodStart:p.periodStart,periodEnd:p.periodEnd,issuedOn:p.issuedOn};
}

// The driver returns DATE columns as JS Date objects (local midnight); the report
// engine compares and formats them as 'YYYY-MM-DD' strings.
export const isoDate=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function dates<T extends Record<string,unknown>>(row:T):T{
  return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v instanceof Date?isoDate(v):v])) as T;
}
