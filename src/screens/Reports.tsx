import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Sparkles, Trash2 } from 'lucide-react';
import { reports as reportsApi } from '../api';
import type { Report } from '../types';
import { Empty, Notice, PageHead, Skeleton, Tag, errorText, fmt, fmtPeriod, useAsync, useScope, useToast } from '../ui';

export default function Reports() {
  const { project, canManage } = useScope();
  const { data, error, reload } = useAsync(() => reportsApi.list(project!.id), [project?.id]);
  const toast = useToast();
  // Deleted reports keep their number reserved: the sequence never reuses it.
  async function remove(r: Report) {
    const reason = prompt(`Excluir o RTP ${r.number} de ${r.scholar_name}? O número ${r.number} não será reutilizado.

Informe o motivo da exclusão:`);
    if (reason === null) return;
    if (reason.trim().length < 5) return toast('Informe o motivo com ao menos 5 caracteres.', 'crit');
    try { await reportsApi.remove(r.id, reason); toast(`RTP ${r.number} excluído.`); void reload(); } catch (x) { toast(errorText(x), 'crit'); }
  }
  const [q, setQ] = useState(''), [status, setStatus] = useState('');
  const rows = (data ?? []).filter((r) => (!status || r.status === status) && `${r.scholar_name} ${r.number}`.toLowerCase().includes(q.toLowerCase()));
  return <>
    <PageHead title="Relatórios" description="Todos os RTPs do projeto, por bolsista e período. Cada edição gera uma versão que pode ser comparada e restaurada."
      actions={canManage && <NavLink className="btn btn-primary" to="/generate"><Sparkles />Gerar RTP</NavLink>} />
    {error ? <Notice tone="crit">{error}</Notice> : !data ? <Skeleton /> : <section className="panel">
      <div className="toolbar">
        <input className="grow" type="search" placeholder="Buscar por bolsista ou número" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar relatório" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação"><option value="">Todas as situações</option><option value="draft">Rascunho</option><option value="pending_review">Em revisão</option><option value="approved">Aprovado</option><option value="exported">Exportado</option></select>
      </div>
      <div className="table-wrap"><table className="ledger">
        <thead><tr><th>RTP</th><th>Bolsista</th><th>Período</th><th>Emissão</th><th>Versão</th><th>Situação</th>{canManage && <th />}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}>
          <td className="num"><NavLink to={`/reports/${r.id}`}><b>{r.number}</b></NavLink></td>
          <td><NavLink to={`/scholars/${r.scholar_id}`} style={{ color: 'inherit' }}>{r.scholar_name}</NavLink></td>
          <td className="num">{fmtPeriod(r.period_start, r.period_end)}</td>
          <td className="num">{fmt(r.issued_on)}</td>
          <td className="num">v{r.current_version}</td>
          <td><Tag status={r.status} /></td>
          {canManage && <td><button className="icon-btn" onClick={() => remove(r)} aria-label={`Excluir RTP ${r.number}`} title="Excluir"><Trash2 /></button></td>}
        </tr>)}</tbody>
      </table></div>
      {!rows.length && <Empty title={data.length ? 'Nenhum relatório atende aos filtros' : 'Nenhum relatório gerado'}>{data.length ? 'Ajuste a busca ou a situação.' : 'Gere o primeiro RTP depois de importar o plano e registrar a execução.'}</Empty>}
    </section>}
  </>;
}
