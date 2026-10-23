import { useMemo, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, Upload } from 'lucide-react';
import { executions as executionsApi, scholars as scholarsApi } from '../api';
import type { Execution, PlanItem } from '../types';
import { Drawer, Empty, Notice, Pivot, Skeleton, Tag, errorText, fmt, fmtPeriod, itemTypesPlural, nextStep, sectorsOf, stageNames, useAsync, useScope, useToast } from '../ui';
import { ExecutionForm, ExecutionLog, type ExecutionDraft } from './Executions';
import { ScholarForm } from './Scholars';
import { Cronograma, gridMonths } from '../Cronograma';
import { describeMonths, isScheduledIn } from '@/lib/schedule';

type Tab = 'plan' | 'execution' | 'gaps' | 'reports' | 'history';

export default function ScholarDetail() {
  const { id } = useParams(), { project, canManage, user } = useScope(), toast = useToast();
  const { data, error, reload } = useAsync(() => scholarsApi.detail(id!), [id]);
  const [tab, setTab] = useState<Tab>('plan'), [draft, setDraft] = useState<ExecutionDraft | null>(null), [editing, setEditing] = useState(false);
  if (error) return <Notice tone="crit" title="Não foi possível abrir o perfil">{error}</Notice>;
  if (!data) return <Skeleton />;
  const { scholar: s, plan, planItems, executions, reports, planHistory } = data;
  const overview = { plan, executions: executions.length, latest: reports[0] ?? null };
  const sectors = sectorsOf(overview);
  const mayWrite = canManage || user.scholarId === s.id;
  const groups = planItems.reduce<Record<string, PlanItem[]>>((all, item) => ((all[item.item_type] ??= []).push(item), all), {});
  const tabs: Array<[Tab, string, number?]> = [['plan', 'Plano de Trabalho', planItems.length], ['execution', 'Execução', executions.length], ['gaps', 'Pendências'], ['reports', 'Relatórios', reports.length], ['history', 'Histórico do plano', planHistory.length]];

  return <>
    <NavLink to="/scholars" className="back"><ArrowLeft />Bolsistas</NavLink>
    <div className="profile">
      <Pivot sectors={sectors} size={112} animate label={nextStep(overview)} />
      <div className="grow">
        <h1>{s.full_name}</h1>
        <p>{s.role_area || 'Área de atuação não informada'}{s.scholarship_type ? `, ${s.scholarship_type}` : ''}</p>
        <dl className="facts" style={{ marginTop: 14 }}>
          <div><dt>Vigência da bolsa</dt><dd>{fmtPeriod(s.starts_on, s.ends_on)}</dd></div>
          <div><dt>Situação</dt><dd><Tag status={s.status} /></dd></div>
          <div><dt>Etapa atual</dt><dd>{stageNames[sectors.reduce((n, x, i) => (x !== 'off' ? i : n), -1)] ?? 'Nenhuma'}</dd></div>
          <div><dt>Próximo passo</dt><dd>{nextStep(overview)}</dd></div>
        </dl>
      </div>
      {canManage && <button className="btn btn-quiet" onClick={() => setEditing(true)}><Pencil />Editar cadastro</button>}
    </div>
    {s.notes && <div style={{ marginBottom: 20 }}><Notice title="Observações administrativas">{s.notes}</Notice></div>}

    <div className="tabs" role="tablist">{tabs.map(([key, label, n]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}{n !== undefined && <em>{n}</em>}</button>)}</div>

    {tab === 'plan' && <section className="panel">
      <div className="panel-head">
        <div><h2>Plano de Trabalho individual</h2><p>{plan ? `Versão ${plan.version}${plan.documents?.original_name ? `, extraída de ${plan.documents.original_name}` : ''}` : 'Nenhum plano importado'}</p></div>
        {canManage && <div className="head-actions">{plan && <NavLink className="btn btn-sm" to={`/plans/${s.id}`}>{plan.status === 'confirmed' ? 'Revisar extração' : 'Conferir extração'}</NavLink>}<NavLink className="btn btn-sm btn-quiet" to="/plans"><Upload />Importar nova versão</NavLink></div>}
      </div>
      {plan && plan.status !== 'confirmed' && <div style={{ padding: '14px 24px 0' }}><Notice tone="warn" title="Extração ainda não conferida">Os itens abaixo foram identificados automaticamente. Confira antes de gerar relatórios.</Notice></div>}
      {plan?.functional_identity && <div className="plan-group"><h3>Responsabilidade no projeto</h3><p>{plan.functional_identity}</p></div>}
      {planItems.length ? Object.entries(groups).map(([type, items]) => <div className="plan-group" key={type}>
        <h3>{itemTypesPlural[type] ?? type}<small>{items.length}</small></h3>
        <ul>{items.map((x) => <li key={x.id}>{x.title}{x.scheduled_months?.length ? <small> ({describeMonths(x.scheduled_months)})</small> : (x.starts_on || x.ends_on) && <small> ({fmtPeriod(x.starts_on, x.ends_on)})</small>}</li>)}</ul>
      </div>) : <Empty title="Plano ainda não importado" action={canManage && <NavLink className="btn btn-primary" to="/plans"><Upload />Importar plano</NavLink>}>Sem o plano individual não há como gerar um RTP fiel às atribuições deste bolsista.</Empty>}
    </section>}
    {tab === 'plan' && planItems.some((i) => i.item_type === 'activity') && <section className="panel" style={{ marginTop: 24 }}>
      <div className="panel-head"><div><h2>Cronograma de atividades individualizado</h2><p>Meses previstos para cada atividade no Plano de Trabalho.</p></div></div>
      <Cronograma items={planItems.filter((i) => i.item_type === 'activity')} months={gridMonths(planItems.filter((i) => i.item_type === 'activity'), s.starts_on, s.ends_on)} />
    </section>}

    {tab === 'execution' && <section className="panel">
      <div className="panel-head"><div><h2>Registros de execução</h2><p>Fatos informados com período, situação e evidências.</p></div>{mayWrite && <button className="btn btn-sm btn-primary" onClick={() => setDraft({})}><Plus />Registrar execução</button>}</div>
      <ExecutionLog items={executions} planItems={planItems} projectId={project!.id} onEdit={mayWrite ? setDraft : undefined} />
    </section>}

    {tab === 'gaps' && <Gaps planItems={planItems} executions={executions} mayWrite={!!mayWrite} onRegister={setDraft} onQuick={async (item, status, note, period) => {
      try {
        await executionsApi.create(s.project_id, s.id, { planItemId: item.id, plannedActivity: item.title, periodStart: period[0], periodEnd: period[1], status, executedActivity: status === 'in_progress' ? note : '', notes: note });
        toast('Situação registrada.'); void reload();
      } catch (x) { toast(errorText(x), 'crit'); }
    }} />}

    {tab === 'reports' && <section className="panel">
      <div className="panel-head"><div><h2>Relatórios do bolsista</h2></div>{canManage && <NavLink className="btn btn-sm btn-primary" to={`/generate?scholar=${s.id}`}>Gerar RTP</NavLink>}</div>
      {reports.length ? <div className="table-wrap"><table className="ledger"><thead><tr><th>RTP</th><th>Período</th><th>Emissão</th><th>Situação</th></tr></thead>
        <tbody>{reports.map((r) => <tr key={r.id}><td><NavLink to={`/reports/${r.id}`}>RTP {r.number}</NavLink></td><td className="num">{fmtPeriod(r.period_start, r.period_end)}</td><td className="num">{fmt(r.issued_on)}</td><td><Tag status={r.status} /></td></tr>)}</tbody></table></div>
        : <Empty title="Nenhum RTP gerado">Os relatórios deste bolsista aparecerão aqui, por período.</Empty>}
    </section>}

    {tab === 'history' && <section className="panel">
      <div className="panel-head"><div><h2>Versões do Plano de Trabalho</h2><p>Uma nova importação substitui a anterior sem apagá-la.</p></div></div>
      {planHistory.length ? <ul className="versions">{planHistory.map((p) => <li key={p.id}><b>v{p.version}</b><div>{p.documents?.original_name ?? 'Documento'}<small>Importado em {fmt(p.created_at)}{p.confirmed_at ? `, conferido em ${fmt(p.confirmed_at)}` : ''}</small></div><Tag status={p.status === 'confirmed' ? 'confirmed' : p.status === 'replaced' ? 'replaced' : 'pending_plan'} /></li>)}</ul>
        : <Empty title="Nenhuma versão">O histórico começa na primeira importação.</Empty>}
    </section>}

    <Drawer open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Editar registro de execução' : 'Registrar execução'} description={s.full_name}>
      <ExecutionForm key={draft?.id ?? `new-${draft?.plan_item_id ?? ''}`} scholar={s} planItems={planItems} initial={draft} onCancel={() => setDraft(null)} onSaved={() => { setDraft(null); void reload(); }} />
    </Drawer>
    <Drawer open={editing} onClose={() => setEditing(false)} title="Editar bolsista">
      <ScholarForm scholar={s} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); toast('Cadastro atualizado.'); void reload(); }} />
    </Drawer>
  </>;
}

const quick: Array<[string, string, string]> = [
  ['in_progress', 'Marcar em andamento', 'Descreva o que já está em curso'],
  ['rescheduled', 'Informar reprogramação', 'Motivo e novo prazo'],
  ['not_applicable', 'Excluir do relato do período', 'Justificativa da exclusão']
];

function Gaps({ planItems, executions, mayWrite, onRegister, onQuick }: { planItems: PlanItem[]; executions: Execution[]; mayWrite: boolean; onRegister: (d: ExecutionDraft) => void; onQuick: (item: PlanItem, status: string, note: string, period: [string, string]) => Promise<void> }) {
  const [start, setStart] = useState(''), [end, setEnd] = useState(''), [open, setOpen] = useState<{ id: string; status: string } | null>(null), [note, setNote] = useState('');
  const gaps = useMemo(() => planItems.filter((i) => i.item_type === 'activity')
    .filter((i) => !start || !end || isScheduledIn(i, start, end))
    .filter((i) => !executions.some((e) => e.plan_item_id === i.id && (!start || !end || (e.period_start <= end && e.period_end >= start)))), [planItems, executions, start, end]);
  const ready = start && end && end >= start;
  return <section className="panel">
    <div className="panel-head"><div><h2>Atividades sem comprovação</h2><p>Atividades previstas sem registro de execução no período. Sem ação, elas aparecem no RTP como pendentes de confirmação.</p></div></div>
    <div className="toolbar">
      <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>Período de<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>a<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      {!ready && <span className="muted" style={{ fontSize: 13 }}>Informe o período para registrar uma situação.</span>}
    </div>
    {gaps.length ? gaps.map((g) => <div className="gap" key={g.id}>
      <h4>{g.title}</h4>
      <p>Não foram localizadas informações suficientes para confirmar a execução desta atividade no período selecionado.</p>
      {mayWrite && <div className="gap-actions">
        <button className="btn btn-sm btn-primary" onClick={() => onRegister({ plan_item_id: g.id, period_start: start, period_end: end })}>Registrar execução</button>
        {quick.map(([status, label]) => <button key={status} className="btn btn-sm" disabled={!ready} onClick={() => { setOpen({ id: g.id, status }); setNote(''); }}>{label}</button>)}
      </div>}
      {open?.id === g.id && <form className="gap-actions" style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); await onQuick(g, open.status, note, [start, end]); setOpen(null); }}>
        <input style={{ flex: 1, minWidth: 220 }} required minLength={10} value={note} onChange={(e) => setNote(e.target.value)} placeholder={quick.find((q) => q[0] === open.status)![2]} autoFocus />
        <button className="btn btn-sm btn-primary">Salvar</button><button type="button" className="btn btn-sm btn-quiet" onClick={() => setOpen(null)}>Cancelar</button>
      </form>}
    </div>) : <Empty title="Nenhuma pendência">{planItems.length ? 'Todas as atividades previstas têm algum registro no período.' : 'Importe o plano para acompanhar as atividades previstas.'}</Empty>}
  </section>;
}
