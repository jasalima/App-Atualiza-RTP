import { useState, type FormEvent } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { Check, RotateCcw, X } from 'lucide-react';
import { reports as reportsApi, scholars as scholarsApi } from '../api';
import type { Execution, PlanItem, Report } from '../types';
import { hasSchedule, isScheduledIn } from '@/lib/schedule';
import { Cronograma, gridMonths } from '../Cronograma';
import { Notice, PageHead, Pivot, Skeleton, Tag, errorText, fmtPeriod, sectorsOf, today, useAsync, useScope } from '../ui';

type Params = { periodStart: string; periodEnd: string; number: string; issuedOn: string; lengthMode: string };
type Detail = Awaited<ReturnType<typeof scholarsApi.detail>>;
type Run = { state: 'waiting' | 'running' | 'done' | 'failed'; report?: Report; error?: string };
type Row = [string, string, 'Validada' | 'A conferir' | 'Ausente', string?];


// Quadro de conferência (spec §9): what the generator will use, where it comes from, and its state.
function checklist(d: Detail, p: Params): Row[] {
  const inPeriod = (i: PlanItem) => isScheduledIn(i, p.periodStart, p.periodEnd);
  const confirmed = d.plan?.status === 'confirmed';
  const planState = (n: number): Row[2] => (!n ? 'Ausente' : confirmed ? 'Validada' : 'A conferir');
  const execs = d.executions.filter((e: Execution) => e.period_start <= p.periodEnd && e.period_end >= p.periodStart);
  const done = execs.filter((e) => e.executed_activity && e.status !== 'not_applicable');
  const results = execs.filter((e) => e.result), products = execs.filter((e) => e.product);
  const evidence = execs.reduce((n, e) => n + (e.evidence?.length ?? 0), 0);
  const of = (t: string) => d.planItems.filter((i) => i.item_type === t);
  const unscheduled = of('activity').filter((i) => !hasSchedule(i)).length;
  const activities = of('activity').filter(inPeriod), outside = execs.filter((e) => e.execution_start && (e.execution_start < p.periodStart || e.execution_start > p.periodEnd));
  return [
    ['Identificação do bolsista', 'Cadastro', d.scholar.full_name && d.scholar.starts_on ? 'Validada' : 'A conferir'],
    ['Objetivos individuais', 'Plano de Trabalho', planState(of('objective').length), `${of('objective').length}`],
    ['Atividades programadas no período', 'Cronograma do plano', planState(activities.length), `${activities.length} de ${of('activity').length}${unscheduled ? `, ${unscheduled} sem meses no cronograma` : ''}`],
    ['Atividades executadas', 'Registro de execução', done.length ? 'A conferir' : 'Ausente', `${done.length} registro(s)${outside.length ? `, ${outside.length} fora do período` : ''}`],
    ['Resultados alcançados', 'Evidências e registros', results.length ? 'A conferir' : 'Ausente', `${results.length} resultado(s), ${evidence} evidência(s)`],
    ['Produtos entregues', 'Evidências e registros', products.length ? 'A conferir' : 'Ausente', `${products.length}`],
    ['Cronograma individualizado', 'Plano de Trabalho', of('activity').some(hasSchedule) ? planState(1) : 'Ausente', of('activity').some(hasSchedule) ? undefined : 'nenhuma atividade com meses marcados'],
    ['Relatórios anteriores', 'Histórico', 'Validada', `${d.reports.length}`]
  ];
}
const tone = { Validada: 'ok', 'A conferir': 'warn', Ausente: 'crit' } as const;

export default function Generate() {
  const { project } = useScope(), [search] = useSearchParams();
  const list = useAsync(() => scholarsApi.list(project!.id), [project?.id]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(search.get('scholar') ? [search.get('scholar')!] : []));
  const [params, setParams] = useState<Params | null>(null), [details, setDetails] = useState<Detail[] | null>(null), [loadError, setLoadError] = useState('');
  const [runs, setRuns] = useState<Record<string, Run>>({}), [running, setRunning] = useState(false);
  const step = Object.keys(runs).length ? 3 : details ? 2 : 1;

  async function review(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const p = Object.fromEntries(new FormData(e.currentTarget)) as Params;
    if (p.periodEnd < p.periodStart) return setLoadError('O período final é anterior ao inicial.');
    setLoadError(''); setParams(p); setDetails(null);
    try { setDetails(await Promise.all([...selected].map((id) => scholarsApi.detail(id)))); } catch (x) { setLoadError(errorText(x)); }
  }
  // One request per scholar: each report is built only from its own plan and records.
  async function generate(ids: string[]) {
    setRunning(true);
    setRuns((r) => ({ ...r, ...Object.fromEntries(ids.map((id) => [id, { state: 'waiting' as const }])) }));
    for (const id of ids) {
      setRuns((r) => ({ ...r, [id]: { state: 'running' } }));
      try { const report = await reportsApi.generate({ ...params!, projectId: project!.id, scholarId: id }); setRuns((r) => ({ ...r, [id]: { state: 'done', report } })); }
      catch (x) { setRuns((r) => ({ ...r, [id]: { state: 'failed', error: errorText(x) } })); }
    }
    setRunning(false);
  }
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const failed = Object.entries(runs).filter(([, r]) => r.state === 'failed').map(([id]) => id);
  const active = (list.data ?? []).filter((s) => s.status === 'active');

  return <>
    <PageHead title="Gerar Relatório Técnico Parcial" description="Escolha um ou vários bolsistas. Cada RTP é produzido separadamente, a partir do plano e dos registros do próprio titular." />
    <ol className="steps">{['Período e bolsistas', 'Conferência dos dados', 'Geração e revisão'].map((s, i) => <li key={s} data-state={i + 1 < step ? 'done' : i + 1 === step ? 'current' : undefined}>{s}</li>)}</ol>
    {!list.data ? <Skeleton /> : <>
      {step === 1 && <form className="stack" onSubmit={review}>
        <section className="panel panel-pad">
          <div className="grid-form" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
            <label className="field">Período inicial<input name="periodStart" type="date" required defaultValue={params?.periodStart} /></label>
            <label className="field">Período final<input name="periodEnd" type="date" required defaultValue={params?.periodEnd} /></label>
            <label className="field">RTP nº<input name="number" required placeholder="01/2026" defaultValue={params?.number} /><small>Numeração por bolsista</small></label>
            <label className="field">Data de emissão<input name="issuedOn" type="date" required defaultValue={params?.issuedOn ?? today()} /></label>
            <label className="field">Extensão do texto<select name="lengthMode" defaultValue={params?.lengthMode ?? 'standard'}><option value="concise">Sintético</option><option value="standard">Padrão institucional</option><option value="detailed">Detalhado</option></select></label>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><div><h2>Bolsistas</h2><p>{selected.size} selecionado(s)</p></div>
            <div className="head-actions"><button type="button" className="btn btn-sm btn-quiet" onClick={() => setSelected(new Set(active.map((s) => s.id)))}>Selecionar ativos</button><button type="button" className="btn btn-sm btn-quiet" onClick={() => setSelected(new Set())}>Limpar</button></div></div>
          <div className="pick">{list.data.map((s) => <label key={s.id}><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} /><Pivot sectors={sectorsOf(s)} size={24} /><span>{s.full_name}<small>{s.plan ? (s.plan.status === 'confirmed' ? 'Plano conferido' : 'Plano a conferir') : 'Sem plano'}{s.status !== 'active' ? `, bolsa ${s.status === 'finished' ? 'encerrada' : 'suspensa'}` : ''}</small></span></label>)}</div>
        </section>
        {loadError && <Notice tone="crit">{loadError}</Notice>}
        <div className="form-foot"><button className="btn btn-primary" disabled={!selected.size}>Conferir dados de {selected.size || ''} bolsista(s)</button></div>
      </form>}

      {step === 2 && (!details ? <Skeleton /> : <div className="stack">
        <Notice tone="info" title="Versão preliminar">Itens “A conferir” ou “Ausente” não impedem a geração: o RTP sai como rascunho e identifica o que não foi confirmado. Nada planejado é apresentado como realizado.</Notice>
        <section className="panel">{details.map((d) => {
          const rows = checklist(d, params!), missing = rows.filter((r) => r[2] === 'Ausente').length;
          return <div className="check-block" key={d.scholar.id}>
            <h3><span>{d.scholar.full_name}</span>{missing ? <Tag tone="warn">{missing} informação(ões) ausente(s)</Tag> : <Tag tone="ok">Dados disponíveis</Tag>}</h3>
            <div className="table-wrap"><table className="check-table"><thead><tr><th>Informação</th><th>Origem</th><th>Situação</th><th>Detalhe</th></tr></thead>
              <tbody>{rows.map(([info, origin, state, note]) => <tr key={info}><td>{info}</td><td>{origin}</td><td><Tag tone={tone[state]}>{state}</Tag></td><td className="muted">{note ?? ''}</td></tr>)}</tbody></table></div>
            {d.planItems.some((i) => i.item_type === 'activity') && <details className="crono-details" open={details.length === 1}>
              <summary>Cronograma com o período do RTP destacado</summary>
              <Cronograma items={d.planItems.filter((i) => i.item_type === 'activity')} months={gridMonths(d.planItems.filter((i) => i.item_type === 'activity'), d.scholar.starts_on, d.scholar.ends_on)} period={[params!.periodStart, params!.periodEnd]} />
            </details>}
          </div>;
        })}</section>
        <div className="form-foot"><button className="btn btn-quiet" onClick={() => setDetails(null)}>Voltar</button><button className="btn btn-primary" onClick={() => generate(details.map((d) => d.scholar.id))}>Gerar {details.length > 1 ? `${details.length} relatórios preliminares` : 'relatório preliminar'}</button></div>
      </div>)}

      {step === 3 && <div className="stack">
        <section className="panel">
          <div className="panel-head"><div><h2>Processamento</h2><p>{fmtPeriod(params!.periodStart, params!.periodEnd)}, RTP {params!.number}</p></div>{!running && failed.length > 0 && <button className="btn btn-sm" onClick={() => generate(failed)}><RotateCcw />Repetir {failed.length} com falha</button>}</div>
          {details!.map((d) => { const r = runs[d.scholar.id] ?? { state: 'waiting' }; return <div className="run-row" key={d.scholar.id}>
            <div>{d.scholar.full_name}{r.error && <small style={{ color: 'var(--alarm)' }}>{r.error}</small>}{r.report?.validations && <small>{r.report.validations.filter((v) => v.severity === 'critical').length} crítica(s), {r.report.validations.filter((v) => v.severity === 'attention').length} ponto(s) de atenção</small>}</div>
            <span>{r.state === 'running' ? <span className="spin" aria-label="Gerando" /> : r.state === 'done' ? <Tag tone="ok"><Check size={12} />Gerado</Tag> : r.state === 'failed' ? <Tag tone="crit"><X size={12} />Falhou</Tag> : <Tag tone="mute">Na fila</Tag>}</span>
            <span>{r.report && <NavLink className="btn btn-sm" to={`/reports/${r.report.id}`}>Revisar</NavLink>}</span>
          </div>; })}
        </section>
        {!running && <div className="form-foot"><NavLink className="btn btn-quiet" to="/reports">Ver todos os relatórios</NavLink><button className="btn" onClick={() => { setRuns({}); setDetails(null); }}>Nova geração</button></div>}
      </div>}
    </>}
  </>;
}
