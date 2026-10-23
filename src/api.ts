'use client';

import { neon } from './neon';

type Json = Record<string, unknown>;
const db = neon as any;

function body(options: RequestInit): Json {
  return options.body && typeof options.body === 'string' ? JSON.parse(options.body) : {};
}
function unwrap<T>({ data, error }: { data: T; error?: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const url = new URL(path, window.location.origin);

  if (method === 'GET' && path === '/projects')
    return unwrap(await db.from('projects').select('*').is('deleted_at', null).order('created_at', { ascending: false })) as T;

  if (method === 'POST' && path === '/projects') {
    const x = body(options);
    return unwrap(await db.from('projects').insert({ title:x.title, executing_institution:x.executingInstitution, support_foundation:x.supportFoundation, coordinator:x.coordinator, starts_on:x.startsOn, ends_on:x.endsOn, description:x.description, general_objective:x.generalObjective, city:x.city }).select().single()) as T;
  }

  if (method === 'GET' && path.startsWith('/scholars?')) {
    const projectId = url.searchParams.get('projectId');
    const rows=unwrap<any[]>(await db.from('scholars').select('*, work_plans(id), reports(id)').eq('project_id', projectId).is('deleted_at', null).order('full_name'));
    return rows.map(x=>({...x,has_plan:(x.work_plans?.length||0)>0,report_count:x.reports?.length||0})) as T;
  }

  if (method === 'POST' && path === '/scholars') {
    const x = body(options);
    return unwrap(await db.from('scholars').insert({ project_id:x.projectId, full_name:x.fullName, role_area:x.roleArea, scholarship_type:x.scholarshipType, starts_on:x.startsOn, ends_on:x.endsOn, status:x.status, notes:x.notes }).select().single()) as T;
  }

  const scholarMatch = path.match(/^\/scholars\/([0-9a-f-]+)$/);
  if (method === 'GET' && scholarMatch) {
    const id = scholarMatch[1];
    const [scholar, items, executions, reports] = await Promise.all([
      db.from('scholars').select('*').eq('id', id).single(),
      db.from('plan_items').select('*').eq('scholar_id', id).order('sort_order'),
      db.from('execution_records').select('*').eq('scholar_id', id).is('deleted_at', null).order('period_start', { ascending:false }),
      db.from('reports').select('*').eq('scholar_id', id).is('deleted_at', null).order('period_start', { ascending:false })
    ]);
    return { scholar:unwrap(scholar), planItems:unwrap(items), executions:unwrap(executions), reports:unwrap(reports) } as T;
  }

  if (method === 'POST' && path === '/executions') {
    const x = body(options);
    return unwrap(await db.from('execution_records').insert({ project_id:x.projectId, scholar_id:x.scholarId, plan_item_id:x.planItemId, period_start:x.periodStart, period_end:x.periodEnd, planned_activity:x.plannedActivity, executed_activity:x.executedActivity, execution_start:x.executionStart, execution_end:x.executionEnd, product:x.product, result:x.result, status:x.status, difficulties:x.difficulties, actions_taken:x.actionsTaken, notes:x.notes }).select().single()) as T;
  }

  if (method === 'GET' && path.startsWith('/reports?')) {
    const projectId = url.searchParams.get('projectId');
    const rows = unwrap<any[]>(await db.from('reports').select('*, scholars(full_name)').eq('project_id', projectId).is('deleted_at', null).order('created_at', { ascending:false }));
    return rows.map(x=>({...x,scholar_name:x.scholars?.full_name})) as T;
  }

  const reportMatch = path.match(/^\/reports\/([0-9a-f-]+)$/);
  if (method === 'GET' && reportMatch) {
    const id=reportMatch[1];
    const [report,versions,validations]=await Promise.all([
      db.from('reports').select('*, scholars(full_name), report_versions!inner(content,traceability,version)').eq('id',id).single(),
      db.from('report_versions').select('version,change_summary,created_at').eq('report_id',id).order('version',{ascending:false}),
      db.from('validations').select('*').eq('report_id',id).order('created_at',{ascending:false})
    ]);
    const row:any=unwrap(report), current=(row.report_versions||[]).find((x:any)=>x.version===row.current_version)??row.report_versions?.[0];
    return {...row,scholar_name:row.scholars?.full_name,content:current?.content,traceability:current?.traceability,versions:unwrap(versions),validations:unwrap(validations)} as T;
  }

  if (method === 'GET' && path === '/dashboard') {
    const [scholars,active,plans,reports,recent]=await Promise.all([
      db.from('scholars').select('id',{count:'exact',head:true}).is('deleted_at',null),
      db.from('scholars').select('id',{count:'exact',head:true}).eq('status','active').is('deleted_at',null),
      db.from('work_plans').select('scholar_id',{count:'exact',head:true}),
      db.from('reports').select('status').is('deleted_at',null),
      db.from('reports').select('id,number,status,period_start,period_end,scholars(full_name)').is('deleted_at',null).order('updated_at',{ascending:false}).limit(8)
    ]);
    const reportRows:any[]=unwrap(reports), statuses=reportRows.reduce((a:any,x:any)=>(a[x.status]=(a[x.status]||0)+1,a),{});
    return {scholars:{total:scholars.count||0,active:active.count||0},plans:plans.count||0,reports:statuses,recent:unwrap<any[]>(recent).map((x:any)=>({...x,scholar_name:x.scholars?.full_name}))} as T;
  }

  // Operações documentais e transacionais permanecem em Route Handlers protegidos.
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...options, headers, credentials:'include' });
  if (!response.ok) { const data=await response.json().catch(()=>({})); throw new Error(data.error||'Não foi possível concluir a operação.'); }
  return response.status===204 ? undefined as T : response.json();
}

export async function download(path:string,filename:string){
  const response=await fetch(`/api${path}`,{credentials:'include'});
  if(!response.ok)throw new Error('Falha ao exportar documento.');
  const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=filename;link.click();URL.revokeObjectURL(url);
}
