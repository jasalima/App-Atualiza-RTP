import { useEffect, useState, type FormEvent } from 'react';
import { Paperclip, Pencil, Plus, Trash2 } from 'lucide-react';
import { executions as executionsApi, scholars as scholarsApi } from '../api';
import type { Execution, PlanItem, Scholar } from '../types';
import SendDocumentButton from '../SendDocumentButton';
import { Drawer, Empty, Notice, PageHead, Skeleton, Tag, errorText, executionStatuses, fmt, fmtPeriod, statusLabel, useAsync, useScope, useToast } from '../ui';

export type ExecutionDraft = Partial<Execution> & { plan_item_id?: string | null };

export function ExecutionForm({ scholar, planItems, initial, onSaved, onCancel }: { scholar: Scholar; planItems: PlanItem[]; initial: ExecutionDraft | null; onSaved: () => void; onCancel: () => void }) {
  const toast = useToast(), [busy, setBusy] = useState(false), [file, setFile] = useState<File | null>(null);
  const activities = planItems.filter((i) => i.item_type === 'activity' || i.item_type === 'product');
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (o.periodEnd < o.periodStart) return toast('O período final é anterior ao inicial.', 'crit');
    if (o.executionStart && (o.executionStart < o.periodStart || o.executionStart > o.periodEnd)) return toast('A execução começa fora do período de referência. Ajuste as datas ou o período.', 'crit');
    const plan = activities.find((i) => i.id === o.planItemId);
    setBusy(true);
    try {
      const body = { ...o, plannedActivity: plan?.title ?? '' };
      const saved = initial?.id ? await executionsApi.update(initial.id, body) : await executionsApi.create(scholar.project_id, scholar.id, body);
      if (file) await executionsApi.attach(scholar.project_id, scholar.id, saved.id, file, o.evidenceDescription ?? '');
      toast(initial?.id ? 'Registro atualizado.' : 'Execução registrada.'); onSaved();
    } catch (x) { toast(errorText(x), 'crit'); } finally { setBusy(false); }
  }
  const i = initial ?? {};
  return <form className="grid-form" onSubmit={save}>
    <p className="fieldset-title">Período de referência<small>O registro só entra em RTPs cujo período o inclua.</small></p>
    <label className="field">Início<input name="periodStart" type="date" required defaultValue={i.period_start} /></label>
    <label className="field">Fim<input name="periodEnd" type="date" required defaultValue={i.period_end} /></label>
    <p className="fieldset-title">O que foi feito<small>Descreva fatos. O que estava previsto vem do plano; aqui entra só o que aconteceu.</small></p>
    <label className="field span-2">Atividade prevista no plano<select name="planItemId" defaultValue={i.plan_item_id ?? ''}><option value="">Sem vínculo com atividade prevista</option>{activities.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label>
    <label className="field span-2">Atividade executada<textarea name="executedActivity" required defaultValue={i.executed_activity} /></label>
    <label className="field">Execução iniciada em<input name="executionStart" type="date" defaultValue={i.execution_start ?? ''} /></label>
    <label className="field">Execução encerrada em<input name="executionEnd" type="date" defaultValue={i.execution_end ?? ''} /></label>
    <label className="field">Situação<select name="status" required defaultValue={i.status ?? 'in_progress'}>{executionStatuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
    <label className="field">Produto gerado<input name="product" defaultValue={i.product} /></label>
    <label className="field span-2">Resultado observado<textarea name="result" defaultValue={i.result} /></label>
    <label className="field">Dificuldades encontradas<textarea name="difficulties" defaultValue={i.difficulties} /></label>
    <label className="field">Providências adotadas<textarea name="actionsTaken" defaultValue={i.actions_taken} /></label>
    <label className="field span-2">Observações<textarea name="notes" defaultValue={i.notes} /></label>
    <p className="fieldset-title">Evidência<small>Planilha, ata, nota técnica ou produto. O arquivo vai para o armazenamento privado do projeto.</small></p>
    <label className="field span-2">Arquivo<input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
    {file && <label className="field span-2">Descrição da evidência<input name="evidenceDescription" placeholder="Ex.: ata da reunião técnica de 12/03" /></label>}
    <div className="form-foot span-2"><button type="button" className="btn btn-quiet" onClick={onCancel}>Cancelar</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : initial?.id ? 'Salvar alterações' : 'Registrar execução'}</button></div>
  </form>;
}

export function ExecutionLog({ items, planItems, projectId, onEdit, onRemove }: { items: Execution[]; planItems: PlanItem[]; projectId: string; onEdit?: (e: Execution) => void; onRemove?: (e: Execution) => void }) {
  const toast = useToast();
  if (!items.length) return <Empty title="Nenhuma execução registrada">Sem registros, o RTP descreve as atividades do plano como pendentes de confirmação.</Empty>;
  return <ul className="log">{items.map((e) => {
    const planned = planItems.find((p) => p.id === e.plan_item_id)?.title ?? e.planned_activity;
    return <li key={e.id}>
      <time>{fmt(e.period_start)}<br />a {fmt(e.period_end)}</time>
      <div>
        <h4>{e.executed_activity || 'Sem descrição da execução'}</h4>
        {planned && <div className="planned">Previsto no plano: {planned}</div>}
        {(e.result || e.product) && <p>{[e.product && `Produto: ${e.product}.`, e.result && `Resultado: ${e.result}`].filter(Boolean).join(' ')}</p>}
        {e.notes && <p className="muted">{e.notes}</p>}
        {!!e.evidence?.length && <div className="attachments">{e.evidence.map((ev) => <span className="document-attachment" key={ev.id}><button className="chip" onClick={() => ev.documents && executionsApi.openEvidence(projectId, ev.documents.storage_key).catch((x) => toast(errorText(x), 'crit'))}><Paperclip />{ev.description || ev.documents?.original_name}</button>{ev.documents?.id && <SendDocumentButton iconOnly source={{kind:'document',id:ev.documents.id,label:ev.documents.original_name}} />}</span>)}</div>}
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
        <Tag status={e.status} />
        {onEdit && <button className="icon-btn" onClick={() => onEdit(e)} aria-label="Editar registro"><Pencil /></button>}
        {onRemove && <button className="icon-btn" onClick={() => onRemove(e)} aria-label="Excluir registro"><Trash2 /></button>}
      </div>
    </li>;
  })}</ul>;
}

export default function Executions() {
  const { project, user, canManage } = useScope(), toast = useToast();
  const list = useAsync(() => scholarsApi.list(project!.id), [project?.id]);
  const [scholarId, setScholarId] = useState(''), [draft, setDraft] = useState<ExecutionDraft | null>(null);
  useEffect(() => {
    const own = user.scholarId && list.data?.find((s) => s.id === user.scholarId);
    if (!scholarId && list.data?.length) setScholarId(own ? own.id : list.data[0].id);
  }, [list.data, scholarId, user.scholarId]);
  const detail = useAsync(() => scholarId ? scholarsApi.detail(scholarId) : Promise.resolve(null), [scholarId]);
  const d = detail.data;
  async function remove(e: Execution) {
    if (!confirm('Excluir este registro? Ele deixará de fundamentar novos RTPs. Versões já geradas não mudam.')) return;
    try { await executionsApi.remove(e.id); toast('Registro excluído.'); void detail.reload(); } catch (x) { toast(errorText(x), 'crit'); }
  }
  const mayWrite = canManage || (d && user.scholarId === d.scholar.id);
  return <>
    <PageHead title="Execução das atividades" description="Registre o que foi efetivamente realizado, com evidências. O planejamento nunca é tratado como execução."
      actions={d && mayWrite && <button className="btn btn-primary" onClick={() => setDraft({})}><Plus />Registrar execução</button>} />
    {list.error ? <Notice tone="crit">{list.error}</Notice> : !list.data ? <Skeleton /> : !list.data.length ? <div className="panel"><Empty title="Nenhum bolsista cadastrado">Cadastre bolsistas para registrar a execução.</Empty></div> :
      <section className="panel">
        <div className="toolbar">
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>Bolsista
            <select value={scholarId} onChange={(e) => setScholarId(e.target.value)} disabled={!canManage}>{list.data.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
          </label>
          {d && <span className="muted" style={{ fontSize: 13 }}>{d.executions.length} registro(s), vigência {fmtPeriod(d.scholar.starts_on, d.scholar.ends_on)}</span>}
        </div>
        {detail.loading && !d ? <div className="panel-pad"><Skeleton /></div> : d && <ExecutionLog items={d.executions} planItems={d.planItems} projectId={project!.id} onEdit={mayWrite ? setDraft : undefined} onRemove={mayWrite ? remove : undefined} />}
      </section>}
    {d && <Drawer open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Editar registro de execução' : 'Registrar execução'} description={d.scholar.full_name}>
      <ExecutionForm key={draft?.id ?? 'new'} scholar={d.scholar} planItems={d.planItems} initial={draft} onCancel={() => setDraft(null)} onSaved={() => { setDraft(null); void detail.reload(); }} />
    </Drawer>}
  </>;
}
