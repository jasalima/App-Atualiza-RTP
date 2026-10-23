import { sql } from './db';

/** Section texts of the current version of every other live report in the project. */
export async function otherReportTexts(projectId:string,exceptReportId?:string){
  const rows=await sql`SELECT rv.content FROM reports r JOIN report_versions rv ON rv.report_id=r.id AND rv.version=r.current_version
    WHERE r.project_id=${projectId}::uuid AND r.deleted_at IS NULL AND (${exceptReportId ?? null}::uuid IS NULL OR r.id<>${exceptReportId ?? null}::uuid)`;
  return rows.flatMap((r)=>Object.values((r.content as {sections?:Record<string,string>})?.sections ?? {}));
}
