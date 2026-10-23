import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { scholars as scholarsApi } from '../api';
import { Empty, Notice, PageHead, Pivot, Skeleton, Tag, fmtPeriod, nextStep, sectorsOf, stageNames, useAsync, useScope } from '../ui';

export default function Dashboard() {
  const { project, canManage } = useScope();
  const { data, error, loading } = useAsync(() => scholarsApi.list(project!.id), [project?.id]);
  const [q, setQ] = useState(''), [status, setStatus] = useState(''), [validity, setValidity] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');

  const rows = useMemo(() => (data ?? []).filter((s) => {
    if (q && !s.full_name.toLowerCase().includes(q.toLowerCase())) return false;
    if (status === 'none' ? s.latest : status && s.latest?.status !== status) return false;
    if (validity && s.status !== validity) return false;
    if (from && (!s.latest || s.latest.period_end < from)) return false;
    if (to && (!s.latest || s.latest.period_start > to)) return false;
    return true;
  }), [data, q, status, validity, from, to]);

  if (loading && !data) return <Skeleton />;
  if (error) return <Notice tone="crit" title="Não foi possível carregar o painel">{error}</Notice>;
  const all = data ?? [];
  const count = (st: string) => all.filter((s) => s.reports.some((r) => r.status === st)).length;
  const reportsBy = (st: string) => all.reduce((n, s) => n + s.reports.filter((r) => r.status === st).length, 0);
  const active = all.filter((s) => s.status === 'active');
  const withoutReport = active.filter((s) => !s.latest).length;
  const unconfirmed = all.filter((s) => s.plan && s.plan.status !== 'confirmed');
  const noPlan = active.filter((s) => !s.plan);

  return <>
    <PageHead title={project!.title} description={`${project!.executing_institution}. Vigência ${fmtPeriod(project!.starts_on, project!.ends_on)}.`}
      actions={canManage && <NavLink className="btn btn-primary" to="/generate"><Sparkles />Gerar RTP</NavLink>} />

    <div className="tally">
      <div><b>{all.length}</b><span>bolsistas cadastrados</span></div>
      <div><b>{active.length}</b><span>com bolsa ativa</span></div>
      <div><b>{all.filter((s) => s.plan).length}</b><span>planos importados</span></div>
      <div data-tone={withoutReport ? 'warn' : undefined}><b>{withoutReport}</b><span>ativos sem RTP</span></div>
      <div><b>{reportsBy('draft')}</b><span>em elaboração</span></div>
      <div data-tone={reportsBy('pending_review') ? 'warn' : undefined}><b>{reportsBy('pending_review')}</b><span>aguardando revisão</span></div>
      <div><b>{reportsBy('approved')}</b><span>aprovados</span></div>
      <div><b>{reportsBy('exported')}</b><span>exportados</span></div>
    </div>

    {!all.length ? <div className="panel"><Empty title="Nenhum bolsista neste projeto" action={canManage && <NavLink className="btn btn-primary" to="/scholars">Cadastrar bolsistas</NavLink>}>Cadastre os bolsistas e importe os Planos de Trabalho individuais para começar o ciclo.</Empty></div> : <div className="stack">
      <section className="panel">
        <div className="panel-head"><div><h2>Ciclo de cada bolsista</h2><p>Cada círculo é um bolsista. O braço aponta para a última etapa alcançada.</p></div></div>
        <div className="field-map">
          {all.map((s, i) => <NavLink to={`/scholars/${s.id}`} key={s.id} title={nextStep(s)}>
            <Pivot sectors={sectorsOf(s)} size={78} animate={i < 40} label={`${s.full_name}: ${nextStep(s)}`} />
            <b>{s.full_name}</b><span>{nextStep(s)}</span>
          </NavLink>)}
        </div>
        <div className="legend">
          {stageNames.map((n, i) => <span key={n}>{i + 1}. {n}</span>)}
          <span><i />concluída</span><span><i className="warn" />aguardando conferência</span><span><i className="off" />não iniciada</span>
        </div>
      </section>

      {(noPlan.length > 0 || unconfirmed.length > 0 || count('pending_review') > 0) && <section className="panel">
        <div className="panel-head"><div><h2>O que precisa de atenção</h2></div></div>
        <ul className="checks">
          {noPlan.length > 0 && <li><div>{noPlan.length === 1 ? '1 bolsista ativo está' : `${noPlan.length} bolsistas ativos estão`} sem Plano de Trabalho<small>{noPlan.slice(0, 4).map((s) => s.full_name).join(', ')}{noPlan.length > 4 ? ` e mais ${noPlan.length - 4}` : ''}</small></div>{canManage && <NavLink className="btn btn-sm" to="/plans">Importar planos</NavLink>}</li>}
          {unconfirmed.map((s) => <li key={s.id}><div>Plano de {s.full_name} aguarda conferência<small>A extração automática precisa ser revisada antes de alimentar o RTP.</small></div>{canManage && <NavLink className="btn btn-sm" to={`/plans/${s.id}`}>Conferir</NavLink>}</li>)}
          {all.flatMap((s) => s.reports.filter((r) => r.status === 'pending_review').map((r) => <li key={r.id}><div>RTP {r.number} de {s.full_name} aguarda aprovação<small>Período {fmtPeriod(r.period_start, r.period_end)}</small></div><NavLink className="btn btn-sm" to={`/reports/${r.id}`}>Revisar</NavLink></li>))}
        </ul>
      </section>}

      <section className="panel">
        <div className="panel-head"><div><h2>Acompanhamento</h2><p>{rows.length} de {all.length} bolsistas</p></div></div>
        <div className="toolbar">
          <input className="grow" type="search" placeholder="Buscar bolsista" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar bolsista" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação do RTP"><option value="">Todas as situações</option><option value="none">Sem RTP</option><option value="draft">Rascunho</option><option value="pending_review">Em revisão</option><option value="approved">Aprovado</option><option value="exported">Exportado</option></select>
          <select value={validity} onChange={(e) => setValidity(e.target.value)} aria-label="Vigência"><option value="">Qualquer vigência</option><option value="active">Bolsa ativa</option><option value="suspended">Suspensa</option><option value="finished">Encerrada</option></select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Período a partir de" title="Período a partir de" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Período até" title="Período até" />
        </div>
        <div className="table-wrap"><table className="ledger">
          <thead><tr><th>Bolsista</th><th>Plano de Trabalho</th><th>Período</th><th>RTP</th><th>Situação</th></tr></thead>
          <tbody>{rows.map((s) => <tr key={s.id}>
            <td><NavLink className="who" to={`/scholars/${s.id}`}><Pivot sectors={sectorsOf(s)} size={26} /><div>{s.full_name}<small>{s.role_area || 'Área não informada'}</small></div></NavLink></td>
            <td>{s.plan ? <Tag status={s.plan.status === 'confirmed' ? 'confirmed' : 'pending_plan'}>{s.plan.status === 'confirmed' ? `Conferido, versão ${s.plan.version}` : 'Importado, a conferir'}</Tag> : <span className="muted">Não importado</span>}</td>
            <td className="num">{s.latest ? fmtPeriod(s.latest.period_start, s.latest.period_end) : '—'}</td>
            <td className="num">{s.latest ? <NavLink to={`/reports/${s.latest.id}`}>{s.latest.number}</NavLink> : '—'}</td>
            <td>{s.latest ? <Tag status={s.latest.status} /> : <span className="muted">Sem RTP</span>}</td>
          </tr>)}</tbody>
        </table></div>
        {!rows.length && <div className="empty"><p>Nenhum bolsista atende aos filtros.</p></div>}
      </section>
    </div>}
  </>;
}
