'use client';

import { neon } from './neon';
import { requestJson } from './request-json';
import type { Execution, ImportResult, ManagedUser, PlanItem, Project, Report, ReportContent, Role, Scholar, ScholarOverview, TravelReport, ProjectDocument, DocumentDetail, User, Validation, WorkPlan } from './types';

const db = neon as any;

// A single-row read that comes back empty without an error (e.g. an interrupted
// request) must not reach the screen as a blank record.
function unwrapRow<T>(result: { data: T | null; error?: { message: string } | null }, what: string): T {
  const row = unwrap(result);
  if (!row) throw new Error(`Não foi possível carregar ${what}. Recarregue a página.`);
  return row;
}

function unwrap<T>({ data, error }: { data: T; error?: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

// Route Handlers: transactional, document and file operations that need server credentials.
export async function route<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestJson<T>(path, options);
}

export async function download(path: string, filename: string) {
  const response = await fetch(`/api${path}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Não foi possível gerar o arquivo. Tente novamente.');
  const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

const projectColumns = (x: Record<string, any>) => ({
  title: x.title, executing_institution: x.executingInstitution, support_foundation: x.supportFoundation,
  coordinator: x.coordinator, starts_on: x.startsOn, ends_on: x.endsOn, description: x.description ?? '',
  general_objective: x.generalObjective ?? '', city: x.city, status: x.status ?? 'active', agreement: x.agreement ?? ''
});
const scholarColumns = (x: Record<string, any>) => ({
  ...(x.phone !== undefined ? { phone: x.phone } : {}), ...(x.email !== undefined ? { email: x.email } : {}),
  full_name: x.fullName, role_area: x.roleArea ?? '', scholarship_type: x.scholarshipType ?? '',
  starts_on: x.startsOn, ends_on: x.endsOn, status: x.status ?? 'active', notes: x.notes ?? ''
});

export const projects = {
  list: (): Promise<Project[]> => route<Project[]>('/projects', { cache: 'no-store' }),
  create: async (x: Record<string, any>): Promise<Project> => unwrap(await db.from('projects').insert(projectColumns(x)).select().single()),
  update: async (id: string, x: Record<string, any>): Promise<Project> => unwrap(await db.from('projects').update(projectColumns(x)).eq('id', id).select().single())
};

function overview(x: any): ScholarOverview {
  const plan = (x.work_plans ?? []).filter((p: any) => p.status !== 'replaced').sort((a: any, b: any) => b.version - a.version)[0] ?? null;
  const reports = (x.reports ?? []).filter((r: any) => !r.deleted_at).sort((a: any, b: any) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  const executions = (x.execution_records ?? []).filter((e: any) => !e.deleted_at).length;
  const { work_plans, execution_records, reports: _r, ...scholar } = x;
  return { ...scholar, plan, executions, reports, latest: reports[0] ?? null };
}

export const scholars = {
  list: async (projectId: string): Promise<ScholarOverview[]> =>
    unwrap<any[]>(await db.from('scholars')
      .select('*, work_plans(id,status,version,confirmed_at), execution_records(id,deleted_at), reports(id,number,status,period_start,period_end,issued_on,updated_at,deleted_at)')
      .eq('project_id', projectId).is('deleted_at', null).order('full_name')).map(overview),
  create: async (projectId: string, x: Record<string, any>): Promise<Scholar> =>
    unwrap(await db.from('scholars').insert({ ...scholarColumns(x), project_id: projectId }).select().single()),
  update: async (id: string, x: Record<string, any>): Promise<Scholar> =>
    unwrap(await db.from('scholars').update(scholarColumns(x)).eq('id', id).select().single()),
  detail: async (id: string) => {
    const [scholar, plans, items, executions, reports] = await Promise.all([
      db.from('scholars').select('*').eq('id', id).single(),
      db.from('work_plans').select('id,document_id,version,status,functional_identity,confirmed_at,created_at,documents(original_name)').eq('scholar_id', id).order('version', { ascending: false }),
      db.from('plan_items').select('*, work_plans!inner(status)').eq('scholar_id', id).neq('work_plans.status', 'replaced').order('sort_order'),
      db.from('execution_records').select('*, evidence(id, description, documents(id,original_name,storage_key))').eq('scholar_id', id).is('deleted_at', null).order('period_start', { ascending: false }),
      db.from('reports').select('*').eq('scholar_id', id).is('deleted_at', null).order('period_start', { ascending: false })
    ]);
    const planRows = unwrap<WorkPlan[]>(plans);
    return {
      scholar: unwrapRow<Scholar>(scholar, 'o bolsista'),
      plan: planRows.find((p) => p.status !== 'replaced') ?? null,
      planHistory: planRows,
      planItems: unwrap<PlanItem[]>(items),
      executions: unwrap<Execution[]>(executions),
      reports: unwrap<Report[]>(reports)
    };
  }
};

export const plans = {
  import: (form: FormData) => route<ImportResult[]>('/plans/import', { method: 'POST', body: form }),
  updateItem: async (id: string, x: Partial<PlanItem>) =>
    unwrap(await db.from('plan_items').update({ item_type: x.item_type, title: x.title, description: x.description ?? '', starts_on: x.starts_on || null, ends_on: x.ends_on || null, scheduled_months: x.scheduled_months ?? [] }).eq('id', id)),
  addItem: async (planId: string, scholar: Scholar, sortOrder: number): Promise<PlanItem> =>
    unwrap(await db.from('plan_items').insert({ work_plan_id: planId, project_id: scholar.project_id, scholar_id: scholar.id, item_type: 'activity', title: 'Nova atividade', source_reference: { manual: true }, sort_order: sortOrder }).select().single()),
  removeItem: async (id: string) => unwrap(await db.from('plan_items').delete().eq('id', id)),
  confirm: async (id: string, userId: string, functionalIdentity: string) =>
    unwrap(await db.from('work_plans').update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: userId, functional_identity: functionalIdentity }).eq('id', id))
};

const executionColumns = (x: Record<string, any>) => ({
  plan_item_id: x.planItemId || null, period_start: x.periodStart, period_end: x.periodEnd,
  planned_activity: x.plannedActivity ?? '', executed_activity: x.executedActivity ?? '',
  execution_start: x.executionStart || null, execution_end: x.executionEnd || null, product: x.product ?? '',
  result: x.result ?? '', status: x.status, difficulties: x.difficulties ?? '', actions_taken: x.actionsTaken ?? '', notes: x.notes ?? ''
});

export const executions = {
  create: async (projectId: string, scholarId: string, x: Record<string, any>): Promise<Execution> =>
    unwrap(await db.from('execution_records').insert({ ...executionColumns(x), project_id: projectId, scholar_id: scholarId }).select().single()),
  update: async (id: string, x: Record<string, any>): Promise<Execution> =>
    unwrap(await db.from('execution_records').update(executionColumns(x)).eq('id', id).select().single()),
  remove: async (id: string) => unwrap(await db.from('execution_records').update({ deleted_at: new Date().toISOString() }).eq('id', id)),
  // The file goes straight to the private bucket through a five-minute signed URL;
  // only its key and SHA-256 are written to the database.
  attach: async (projectId: string, scholarId: string, executionId: string, file: File, description: string) => {
    const signed = await route<{ key: string; url: string }>('/storage/sign', { method: 'POST', body: JSON.stringify({ projectId, fileName: file.name, contentType: file.type || 'application/octet-stream' }) });
    const put = await fetch(signed.url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
    if (!put.ok) throw new Error('O armazenamento recusou o arquivo.');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map((b) => b.toString(16).padStart(2, '0')).join('');
    const doc = unwrap<{ id: string }>(await db.from('documents').insert({ project_id: projectId, scholar_id: scholarId, kind: 'evidence', original_name: file.name, mime_type: file.type || 'application/octet-stream', size_bytes: file.size, storage_key: signed.key, sha256: hash, extraction_status: 'not_applicable' }).select('id').single());
    return unwrap(await db.from('evidence').insert({ execution_id: executionId, document_id: doc.id, description }).select().single());
  },
  openEvidence: async (projectId: string, key: string) => {
    const { url } = await route<{ url: string }>('/storage/sign', { method: 'POST', body: JSON.stringify({ projectId, operation: 'download', key }) });
    window.open(url, '_blank', 'noopener');
  }
};

export const reports = {
  list: async (projectId: string): Promise<Report[]> =>
    unwrap<any[]>(await db.from('reports').select('*, scholars(full_name)').eq('project_id', projectId).is('deleted_at', null).order('created_at', { ascending: false }))
      .map((x) => ({ ...x, scholar_name: x.scholars?.full_name })),
  get: async (id: string): Promise<Report> => {
    const [report, versions, validations] = await Promise.all([
      db.from('reports').select('*, scholars(full_name)').eq('id', id).single(),
      db.from('report_versions').select('version,content,change_summary,created_at').eq('report_id', id).order('version', { ascending: false }),
      db.from('validations').select('*').eq('report_id', id).order('created_at', { ascending: true })
    ]);
    const row: any = unwrapRow(report, 'o relatório'), all: any[] = unwrap(versions), current = all.find((v) => v.version === row.current_version) ?? all[0];
    return { ...row, scholar_name: row.scholars?.full_name, content: current?.content, versions: all, validations: unwrap<Validation[]>(validations) };
  },
  generate: (body: Record<string, string>) => route<Report>('/reports/generate', { method: 'POST', body: JSON.stringify(body) }),
  save: (id: string, content: ReportContent, changeSummary: string) => route<{ version: number }>(`/reports/${id}`, { method: 'PUT', body: JSON.stringify({ content, changeSummary }) }),
  regenerate: (id: string, section: keyof ReportContent['sections']) => route<{ version: number; content: ReportContent }>(`/reports/${id}/regenerate`, { method: 'POST', body: JSON.stringify({ section }) }),
  submit: async (id: string) => unwrap(await db.from('reports').update({ status: 'pending_review' }).eq('id', id)),
  approve: (id: string) => route(`/reports/${id}/approve`, { method: 'POST' }),
  reopen: (id: string, reason: string) => route(`/reports/${id}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) }),
  remove: (id: string, reason: string) => route(`/reports/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
  usedNumbers: async (projectId: string): Promise<string[]> =>
    unwrap<Array<{ number: string }>>(await db.from('reports').select('number').eq('project_id', projectId)).map((r) => r.number),
  resolve: (id: string, validationId: string, note: string) => route<Validation>(`/reports/${id}/validations`, { method: 'PATCH', body: JSON.stringify({ validationId, note }) })
};

// Project document library. Files go straight to the private bucket through a
// five-minute signed URL (no 4.5 MB function limit); the server then checks the
// stored object and registers it with its SHA-256.
export type DocumentMeta = { title: string; category: string; description: string; scholarId: string | null; validUntil: string | null };
export const documents = {
  list: (projectId: string) => route<ProjectDocument[]>(`/documents?projectId=${projectId}`),
  detail: (projectId: string, id: string) => route<DocumentDetail>(`/documents/${id}?projectId=${projectId}`),
  update: (projectId: string, id: string, meta: DocumentMeta) => route<ProjectDocument>(`/documents/${id}?projectId=${projectId}`, { method: 'PATCH', body: JSON.stringify(meta) }),
  remove: (projectId: string, id: string, reason: string) => route(`/documents/${id}?projectId=${projectId}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
  open: async (projectId: string, id: string, mode: 'view' | 'download') => {
    // The tab is opened before awaiting so popup blockers accept it.
    const tab = mode === 'view' ? window.open('about:blank', '_blank') : null;
    try {
      const { url } = await route<{ url: string }>(`/documents/${id}/download?projectId=${projectId}&mode=${mode}`);
      if (tab) tab.location.href = url; else window.location.assign(url);
    } catch (e) { tab?.close(); throw e; }
  },
  upload: async (projectId: string, file: File, meta: DocumentMeta, replacesId: string | null, onProgress: (fraction: number) => void) => {
    const contentType = file.type || 'application/octet-stream';
    const signed = await route<{ key: string; url: string }>('/storage/sign', { method: 'POST', body: JSON.stringify({ projectId, fileName: file.name, contentType }) });
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', signed.url); xhr.setRequestHeader('Content-Type', contentType);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('O armazenamento recusou o arquivo.')));
      xhr.onerror = () => reject(new Error('Falha de conexão durante o envio do arquivo.'));
      xhr.send(file);
    });
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map((b) => b.toString(16).padStart(2, '0')).join('');
    return route<ProjectDocument>('/documents', { method: 'POST', body: JSON.stringify({ ...meta, projectId, key: signed.key, originalName: file.name, mimeType: contentType, size: file.size, sha256, replacesId }) });
  }
};

// Filled Formulário 26 reports (prestação de contas de diárias e passagens).
export const travelReports = {
  list: (projectId: string) => route<TravelReport[]>(`/travel/reports?projectId=${projectId}`),
  start: (projectId: string, scholarId: string) => route<TravelReport>('/travel/reports', { method: 'POST', body: JSON.stringify({ projectId, scholarId }) }),
  get: (projectId: string, id: string) => route<TravelReport>(`/travel/reports/${id}?projectId=${projectId}`),
  save: (projectId: string, id: string, body: Omit<TravelReport, 'id' | 'projectId' | 'scholarId' | 'scholarName' | 'createdAt' | 'updatedAt' | 'beneficiary'>) =>
    route<TravelReport>(`/travel/reports/${id}?projectId=${projectId}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (projectId: string, id: string) => route(`/travel/reports/${id}?projectId=${projectId}`, { method: 'DELETE' }),
  export: (projectId: string, id: string, format: 'pdf' | 'docx', filename: string) => download(`/travel/reports/${id}/export?projectId=${projectId}&format=${format}`, filename)
};

export const settings = {
  status: () => route<{ database: boolean; auth: boolean; dataApi: boolean; storage: boolean; bucket: string; ai: { provider: string; model: string | null; configured: boolean } }>('/settings/status')
};

export const users = {
  me: () => route<User>('/users/me'),
  list: () => route<ManagedUser[]>('/users'),
  create: (body: { name: string; email: string; role: Exclude<Role, 'admin'>; projectId: string; scholarId?: string | null }) =>
    route<{ userId: string; temporaryPassword: string; whatsappProvisioned: boolean }>('/users', { method: 'POST', body: JSON.stringify(body) }),
  setStatus: (id: string, action: 'revoke' | 'restore') =>
    route<{ success: boolean }>(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ action }) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    route<{ success: boolean }>('/users/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) })
};
