import { useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Check, Download, Plus, Trash2 } from 'lucide-react';
import { travelReports } from '../api';
import type { TravelEntry, TravelReport } from '../types';
import SendDocumentButton from '../SendDocumentButton';
import { Notice, Skeleton, Tag, errorText, useScope, useToast } from '../ui';

// One row per day between departure and return, keeping what was already typed.
function tripDays(start: string, end: string, current: TravelEntry[]) {
  const out: TravelEntry[] = [];
  for (let d = new Date(`${start}T12:00:00Z`), last = new Date(`${end}T12:00:00Z`); d <= last && out.length < 60; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    out.push(current.find((e) => e.date === date) ?? { date, activity: '' });
  }
  return [...out, ...current.filter((e) => !e.date && e.activity.trim())];
}

export default function TravelReportEditor() {
  const { id } = useParams(), { project, canManage } = useScope(), toast = useToast();
  const [report, setReport] = useState<TravelReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState('');
  useEffect(() => { travelReports.get(project!.id, id!).then((r) => { setReport(r); setSaved(JSON.stringify(r)); }, (e) => setError(errorText(e))); }, [project, id]);
  if (error) return <Notice tone="crit" title="Não foi possível abrir o relatório de viagem">{error}</Notice>;
  if (!report) return <Skeleton />;
  const r = report, dirty = JSON.stringify(r) !== saved;
  const locked = r.status === 'finalized' && !canManage;
  const set = (patch: Partial<TravelReport>) => setReport({ ...r, ...patch });
  const setEntry = (i: number, patch: Partial<TravelEntry>) => set({ entries: r.entries.map((e, n) => (n === i ? { ...e, ...patch } : e)) });

  async function save(status: TravelReport['status'] = r.status) {
    setBusy(true);
    try {
      const next = await travelReports.save(project!.id, r.id, { origin: r.origin, destination: r.destination, departureDate: r.departureDate || null, returnDate: r.returnDate || null, paymentDate: r.paymentDate || null, objective: r.objective, entries: r.entries, status });
      const merged = { ...next, beneficiary: r.beneficiary };
      setReport(merged); setSaved(JSON.stringify(merged));
      toast(status === 'finalized' && r.status !== 'finalized' ? 'Relatório concluído.' : status === 'draft' && r.status === 'finalized' ? 'Relatório reaberto para edição.' : 'Relatório salvo.');
    } catch (e) { toast(errorText(e), 'crit'); } finally { setBusy(false); }
  }
  const file = (format: 'pdf' | 'docx') => travelReports.export(project!.id, r.id, format, `Formulario-26-${(r.scholarName ?? 'membro').replace(/\s+/g, '-')}${r.destination ? `-${r.destination.replace(/[^\p{L}\p{N}]+/gu, '-')}` : ''}.${format}`).catch((e) => toast(errorText(e), 'crit'));
  const b = r.beneficiary;

  return <>
    <NavLink to="/travel" className="back"><ArrowLeft />Diárias e passagens</NavLink>
    <div className="head">
      <div><h1>Relatório de viagem</h1><p>{r.scholarName}{r.destination ? `, viagem a ${r.destination}` : ''}. Formulário 26 da FAPTO.</p></div>
      <div className="head-actions">
        {dirty && <span className="dirty" style={{ alignSelf: 'center' }}>Alterações não salvas</span>}
        <Tag tone={r.status === 'finalized' ? 'ok' : 'info'}>{r.status === 'finalized' ? 'Concluído' : 'Em preenchimento'}</Tag>
        {!locked && <button className="btn" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Salvando…' : 'Salvar'}</button>}
        {r.status === 'draft' && <button className="btn btn-go" disabled={busy} onClick={() => void save('finalized')}><Check />Concluir</button>}
        {r.status === 'finalized' && canManage && <button className="btn" disabled={busy} onClick={() => void save('draft')}>Reabrir</button>}
      </div>
    </div>
    {locked && <div style={{ marginBottom: 18 }}><Notice tone="info" title="Relatório concluído">Para alterar, peça à coordenação para reabri-lo.</Notice></div>}

    <div className="split">
      <div className="stack">
        <section className="panel panel-pad">
          <h3 style={{ fontSize: 18, marginBottom: 10 }}>Identificação do beneficiário</h3>
          <dl className="facts"><div><dt>Nome</dt><dd>{b?.name}</dd></div><div><dt>Função no projeto</dt><dd>{b?.role || 'Não informada'}</dd></div><div><dt>Telefone</dt><dd>{b?.phone || 'Não cadastrado'}</dd></div><div><dt>E-mail</dt><dd>{b?.email || 'Não cadastrado'}</dd></div></dl>
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>Vem do cadastro do membro. Para corrigir, edite o cadastro do bolsista.</p>
        </section>

        <section className="panel panel-pad">
          <h3 style={{ fontSize: 18, marginBottom: 14 }}>Identificação do afastamento</h3>
          <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="grid-form">
              <label className="field">Cidade/UF de origem<input value={r.origin} onChange={(e) => set({ origin: e.target.value })} placeholder="Palmas/TO" /><small>Padrão: Palmas/TO</small></label>
              <label className="field">Cidade/UF de destino<input value={r.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="Lagoa da Confusão/TO" /></label>
              <label className="field">Saída<input type="date" value={r.departureDate ?? ''} onChange={(e) => set({ departureDate: e.target.value || null })} /></label>
              <label className="field">Retorno<input type="date" value={r.returnDate ?? ''} min={r.departureDate ?? undefined} onChange={(e) => set({ returnDate: e.target.value || null })} /></label>
              <label className="field">Data do pagamento da diária<input type="date" value={r.paymentDate ?? ''} onChange={(e) => set({ paymentDate: e.target.value || null })} /><small>Opcional</small></label>
            </div>
          </fieldset>
        </section>

        <section className="panel panel-pad">
          <h3 style={{ fontSize: 18, marginBottom: 4 }}>Descrição da viagem</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Descreva o objetivo da viagem e relate os resultados, assim como outras informações pertinentes.</p>
          <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }}>
            <label className="field">Objetivo e resultados<textarea value={r.objective} onChange={(e) => set({ objective: e.target.value })} style={{ minHeight: 120 }} /></label>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, margin: '18px 0 8px', flexWrap: 'wrap' }}>
              <b style={{ fontSize: 14 }}>Atividades por data</b>
              <div className="head-actions">
                <button type="button" className="btn btn-sm" disabled={!r.departureDate || !r.returnDate} onClick={() => set({ entries: tripDays(r.departureDate!, r.returnDate!, r.entries) })} title={!r.departureDate || !r.returnDate ? 'Informe saída e retorno' : undefined}><CalendarDays />Um dia por linha</button>
                <button type="button" className="btn btn-sm" onClick={() => set({ entries: [...r.entries, { date: '', activity: '' }] })}><Plus />Linha</button>
              </div>
            </div>
            {r.entries.length ? <div className="travel-entries">{r.entries.map((e, i) => <div className="travel-entry" key={i}>
              <input type="date" value={e.date} onChange={(ev) => setEntry(i, { date: ev.target.value })} aria-label={`Data da linha ${i + 1}`} />
              <textarea value={e.activity} onChange={(ev) => setEntry(i, { activity: ev.target.value })} aria-label={`Atividades da linha ${i + 1}`} placeholder="Atividades realizadas nesta data" />
              <button type="button" className="icon-btn" onClick={() => set({ entries: r.entries.filter((_, n) => n !== i) })} aria-label={`Remover linha ${i + 1}`}><Trash2 /></button>
            </div>)}</div> : <p className="muted" style={{ fontSize: 13.5 }}>Sem linhas: o documento sai com cinco linhas em branco. Use “Um dia por linha” para preencher conforme as datas da viagem.</p>}
          </fieldset>
          <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>As duas últimas linhas do quadro (data e assinatura do beneficiário e de acordo da coordenação) saem em branco para assinatura.</p>
        </section>
      </div>

      <aside className="side">
        <div className="panel">
          <h3>Documento</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            <button className="btn btn-block" disabled={dirty || busy} onClick={() => void file('docx')}><Download />DOCX editável</button>
            <button className="btn btn-block" disabled={dirty || busy} onClick={() => void file('pdf')}><Download />PDF</button>
            <SendDocumentButton disabled={dirty || busy} className="btn-block" source={{ kind: 'travel', id: r.id, label: `Formulário 26 — ${r.scholarName}${r.destination ? ` (${r.destination})` : ''}`, scholarId: r.scholarId }} />
          </div>
          {dirty && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Salve antes de exportar ou enviar.</p>}
        </div>
        <div className="panel">
          <h3>Lembretes do formulário</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, display: 'grid', gap: 6 }}>
            <li>Anexe os comprovantes do deslocamento (bilhete, hospedagem, refeição, táxi).</li>
            <li>Entregue em até 15 dias corridos após o retorno.</li>
            <li>Envie assinado digitalmente ao analista do projeto.</li>
          </ul>
        </div>
      </aside>
    </div>
  </>;
}
