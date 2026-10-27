import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Download, FilePlus2, Trash2 } from 'lucide-react';
import { download, scholars, travelReports } from '../api';
import type { ScholarOverview, TravelReport } from '../types';
import SendDocumentButton from '../SendDocumentButton';
import { Drawer, Empty, Notice, PageHead, Skeleton, Tag, errorText, fmt, fmtPeriod, useScope, useToast } from '../ui';

export default function TravelAccountability() {
  const { project, user, canManage } = useScope();
  return <TravelSection key={`${user.id}:${project!.id}`} projectId={project!.id} scholarId={user.scholarId} canManage={canManage} />;
}

function TravelSection({ projectId, scholarId, canManage }: { projectId: string; scholarId?: string | null; canManage: boolean }) {
  const toast = useToast(), nav = useNavigate();
  const [members, setMembers] = useState<ScholarOverview[]>([]), [reports, setReports] = useState<TravelReport[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false), [startFor, setStartFor] = useState(''), [blankFor, setBlankFor] = useState('');
  const load = () => Promise.all([scholars.list(projectId), travelReports.list(projectId)]).then(([rows, list]) => {
    const allowed = canManage ? rows : rows.filter((row) => row.id === scholarId);
    setMembers(allowed); setReports(list);
    setStartFor((current) => current || allowed[0]?.id || ''); setBlankFor((current) => current || allowed[0]?.id || '');
  });
  useEffect(() => {
    let active = true;
    load().catch((e) => { if (active) setError(errorText(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, scholarId, canManage]);

  // "Iniciar relatório de prestação de contas": choose the member, then fill the report.
  async function start() {
    setBusy(true);
    try { const created = await travelReports.start(projectId, startFor); nav(`/travel/${created.id}`); }
    catch (e) { toast(errorText(e), 'crit'); setBusy(false); }
  }
  async function remove(r: TravelReport) {
    if (!confirm(`Excluir o relatório de viagem de ${r.scholarName}${r.destination ? ` a ${r.destination}` : ''}?`)) return;
    try { await travelReports.remove(projectId, r.id); setReports((list) => list.filter((x) => x.id !== r.id)); toast('Relatório de viagem excluído.'); }
    catch (e) { toast(errorText(e), 'crit'); }
  }
  async function exportBlank(format: 'pdf' | 'docx') {
    const member = members.find((m) => m.id === blankFor);
    setBusy(true);
    try { await download(`/travel/export?projectId=${projectId}&scholarId=${blankFor}&format=${format}`, `Formulario-26-${member?.full_name ?? 'membro'}.${format}`); }
    catch (e) { toast(errorText(e), 'crit'); } finally { setBusy(false); }
  }

  return <>
    <PageHead title="Prestação de contas de diárias e passagens" description="Formulário 26 da FAPTO. Inicie um relatório para o membro do projeto, preencha os dados da viagem e exporte ou envie o documento."
      actions={members.length > 0 && <button className="btn btn-primary" onClick={() => setStarting(true)}><FilePlus2 />Iniciar relatório de prestação de contas</button>} />
    {error ? <Notice tone="crit">{error}</Notice> : loading ? <Skeleton /> : <div className="stack">
      {!members.length && <Notice>Cadastre um membro ou solicite à coordenação o vínculo da sua conta ao beneficiário.</Notice>}
      <section className="panel">
        <div className="panel-head"><div><h2>Relatórios de viagem</h2><p>{reports.length ? `${reports.length} relatório(s) no projeto` : 'Os relatórios iniciados aparecem aqui.'}</p></div></div>
        {reports.length ? <div className="table-wrap"><table className="ledger">
          <thead><tr><th>Beneficiário</th><th>Destino</th><th>Viagem</th><th>Situação</th><th>Atualizado</th><th /></tr></thead>
          <tbody>{reports.map((r) => <tr key={r.id}>
            <td><NavLink to={`/travel/${r.id}`}><b>{r.scholarName}</b></NavLink></td>
            <td>{r.destination || <span className="muted">A preencher</span>}{r.origin && <div className="muted" style={{ fontSize: 12.5 }}>saindo de {r.origin}</div>}</td>
            <td className="num">{r.departureDate ? fmtPeriod(r.departureDate, r.returnDate) : <span className="muted">—</span>}</td>
            <td><Tag tone={r.status === 'finalized' ? 'ok' : 'info'}>{r.status === 'finalized' ? 'Concluído' : 'Em preenchimento'}</Tag></td>
            <td className="num">{fmt(r.updatedAt)}</td>
            <td><div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
              <SendDocumentButton iconOnly source={{ kind: 'travel', id: r.id, label: `Formulário 26 — ${r.scholarName}${r.destination ? ` (${r.destination})` : ''}`, scholarId: r.scholarId }} />
              <button className="icon-btn" onClick={() => void remove(r)} aria-label="Excluir relatório de viagem" title="Excluir"><Trash2 /></button>
            </div></td>
          </tr>)}</tbody>
        </table></div> : <Empty title="Nenhum relatório de viagem" action={members.length > 0 && <button className="btn btn-primary" onClick={() => setStarting(true)}><FilePlus2 />Iniciar relatório de prestação de contas</button>}>Inicie o relatório escolhendo o membro do projeto. Os dados do beneficiário vêm do cadastro; os da viagem você preenche em seguida.</Empty>}
      </section>

      {members.length > 0 && <section className="panel panel-pad">
        <h3 style={{ fontSize: 18, marginBottom: 6 }}>Formulário em branco</h3>
        <p className="muted" style={{ marginBottom: 14 }}>Para preenchimento manual: os dados do beneficiário saem preenchidos e os da viagem ficam em branco.</p>
        <div className="head-actions" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ minWidth: 240 }}>Beneficiário<select value={blankFor} onChange={(e) => setBlankFor(e.target.value)}>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select></label>
          <button className="btn" disabled={busy} onClick={() => void exportBlank('docx')}><Download />DOCX</button>
          <button className="btn" disabled={busy} onClick={() => void exportBlank('pdf')}><Download />PDF</button>
          <SendDocumentButton disabled={busy || !blankFor} source={{ kind: 'travel', id: blankFor, label: `Formulário 26 em branco — ${members.find((m) => m.id === blankFor)?.full_name ?? ''}`, scholarId: blankFor }} />
        </div>
        <p className="muted" style={{ marginTop: 12 }}>Gerencie o WhatsApp e o QR Code em <NavLink to="/connectivity">Conectividade</NavLink>.</p>
      </section>}
    </div>}

    <Drawer open={starting} onClose={() => setStarting(false)} title="Iniciar relatório de prestação de contas" description="Escolha o membro do projeto. Em seguida, você preenche os dados da viagem.">
      <div className="grid-form">
        <label className="field span-2">Membro do projeto<select value={startFor} onChange={(e) => setStartFor(e.target.value)}>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.role_area ? ` — ${m.role_area}` : ''}</option>)}</select></label>
        {(() => { const m = members.find((x) => x.id === startFor); return m && <dl className="facts span-2"><div><dt>Função</dt><dd>{m.role_area || 'Não informada'}</dd></div><div><dt>Telefone</dt><dd>{m.phone || 'Não cadastrado'}</dd></div><div><dt>E-mail</dt><dd>{m.email || 'Não cadastrado'}</dd></div></dl>; })()}
        <div className="form-foot span-2"><button className="btn btn-quiet" onClick={() => setStarting(false)}>Cancelar</button><button className="btn btn-primary" disabled={busy || !startFor} onClick={() => void start()}>{busy ? 'Iniciando…' : 'Iniciar e preencher'}</button></div>
      </div>
    </Drawer>
  </>;
}
