import { sql } from './db';

type Params={projectId:string;scholarId:string;periodStart:string;periodEnd:string;number:string;issuedOn:string};

// Every query is pinned to one scholar: this is the boundary that keeps one
// scholar's plan and execution out of another scholar's report.
export async function loadReportInput(p:Params){
  const [projectRows,scholarRows,planRows,planItems,executions]=await Promise.all([
    sql`SELECT * FROM projects WHERE id=${p.projectId}::uuid AND deleted_at IS NULL`,
    sql`SELECT * FROM scholars WHERE id=${p.scholarId}::uuid AND project_id=${p.projectId}::uuid AND deleted_at IS NULL`,
    sql`SELECT status FROM work_plans WHERE scholar_id=${p.scholarId}::uuid AND status<>'replaced' ORDER BY version DESC LIMIT 1`,
    sql`SELECT pi.* FROM plan_items pi JOIN work_plans w ON w.id=pi.work_plan_id WHERE pi.scholar_id=${p.scholarId}::uuid AND w.status<>'replaced' ORDER BY pi.sort_order`,
    sql`SELECT * FROM execution_records WHERE scholar_id=${p.scholarId}::uuid AND deleted_at IS NULL AND period_start<=${p.periodEnd}::date AND period_end>=${p.periodStart}::date`
  ]);
  if(!projectRows[0]||!scholarRows[0])return null;
  return {project:projectRows[0],scholar:scholarRows[0],planStatus:planRows[0]?.status as string|undefined,planItems:[...planItems],executions:[...executions],number:p.number,periodStart:p.periodStart,periodEnd:p.periodEnd,issuedOn:p.issuedOn};
}
