import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, Download, RefreshCw, Trash2 } from 'lucide-react';
import { download, reports as reportsApi } from '../api';
import type { Report, ReportContent, Validation } from '../types';
import { Notice, Skeleton, Tag, errorText, fmt, fmtPeriod, statusLabel, useScope, useToast } from '../ui';

type Section = keyof ReportContent['sections'];
// Same titles as the exported DOCX/PDF (server/services/export.ts).
const sectionTitles: Array<[Section, string, string?]> = [
  ['results', '1.1 Objetivos propostos no plano individual versus objetivos alcançados', '1. Resultados Parciais'],
  ['comparison', '1.2 Resultados esperados versus resultados obtidos (conforme cronograma estabelecido)'],
  ['additional', '', '2. Informações Adicionais']
];
const flow = ['draft', 'pending_review', 'approved', 'exported'];

function AutoText({ value, onChange, label, readOnly }: { value: string; onChange: (v: string) => void; label: string; readOnly: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }, [value]);
  return <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} readOnly={readOnly} spellCheck lang="pt-BR" />;
}

export default function ReportEditor() {
  const { id } = useParams(), { canManage } = useScope(), toast = useToast(), nav = useNavigate();
  async function remove() {
    const reason = prompt(`Excluir o RTP ${report!.number}? Ele sairá das listas, mas fica guardado no histórico de auditoria, e o número ${report!.number} não será reutilizado.\n\nInforme o motivo da exclusão:`);
    if (reason === null) return;
    if (reason.trim().length < 5) return toast('Informe o motivo com ao menos 5 caracteres.', 'crit');
    try { await reportsApi.remove(id!, reason); toast(`RTP ${report!.number} excluído.`); nav('/reports'); } catch (x) { toast(errorText(x), 'crit'); }
  }
  const [report, setReport] = useState<Report | null>(null), [content, setContent] = useState<ReportContent | null>(null), [error, setError] = useState('');
  const [tab, setTab] = useState<'document' | 'validation' | 'versions'>('document'), [busy, setBusy] = useState<string | null>(null), [compare, setCompare] = useState<number | null>(null);
  const load = () => reportsApi.get(id!).then((r) => { setReport(r); setContent(r.content!); }, (x) => setError(errorText(x)));
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!report && !!content && JSON.stringify(content) !== JSON.stringify(report.content);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (error) return <Notice tone="crit" title="Não foi possível abrir o relatório">{error}</Notice>;
  if (!report || !content) return <Skeleton />;

  const open = (report.validations ?? []).filter((v) => !v.resolved_at);
  const critical = open.filter((v) => v.severity === 'critical');
  const locked = !canManage || report.status === 'approved' || report.status === 'exported';
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try { await fn(); await load(); toast(done); } catch (x) { toast(errorText(x), 'crit'); } finally { setBusy(null); }
  };
  const save = (summary = 'Revisão manual no editor') => act('save', () => reportsApi.save(id!, content, summary), 'Versão salva.');
  const setSection = (k: Section, v: string) => setContent({ ...content, sections: { ...content.sections, [k]: v } });
  const regenerate = (k: Section) => {
    if (dirty && !confirm('Há alterações não salvas. A regeneração parte da última versão salva e descartará essas alterações. Continuar?')) return;
    void act(`regen-${k}`, () => reportsApi.regenerate(id!, k), 'Seção regenerada como nova versão.');
  };
  const file = (fmtName: 'docx' | 'pdf') => act(fmtName, () => download(`/reports/${id}/export/${fmtName}`, `RTP-${report.number.replace(/[^a-z0-9-]/gi, '_')}-${content.heading.scholar.split(' ')[0]}.${fmtName}`), report.status === 'approved' ? 'Arquivo exportado. O RTP passou para “Exportado”.' : 'Arquivo gerado.');
  const stage = flow.indexOf(report.status);

  return <>
    <NavLink to="/reports" className="back"><ArrowLeft />Relatórios</NavLink>
    <div className="head">
      <div><h1>RTP {report.number}</h1><p>{report.scholar_name}, período {fmtPeriod(report.period_start, report.period_end)}. Versão {report.current_version}.</p></div>
      <div className="head-actions">{dirty && <span className="dirty" style={{ alignSelf: 'center' }}>Alterações não salvas</span>}{!locked && <button className="btn" disabled={!dirty || !!busy} onClick={() => save()}>{busy === 'save' ? 'Salvando…' : 'Salvar versão'}</button>}{canManage && <button className="btn btn-quiet btn-danger" disabled={!!busy} onClick={remove}><Trash2 />Excluir</button>}</div>
    </div>
    <div className="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'document'} onClick={() => setTab('document')}>Documento</button>
      <button role="tab" aria-selected={tab === 'validation'} onClick={() => setTab('validation')}>Validação<em>{open.length}</em></button>
      <button role="tab" aria-selected={tab === 'versions'} onClick={() => setTab('versions')}>Versões<em>{report.versions?.length ?? 0}</em></button>
    </div>

    {tab === 'document' && <div className="editor">
      <div className="desk"><article className="paper" lang="pt-BR">
        <header>
          <img src="/fapto-logo.png" alt="FAPTO, Fundação de Apoio Científico e Tecnológico do Tocantins" />
          <p>{content.heading.foundation.toLocaleUpperCase('pt-BR')}</p>
          <p>{content.heading.form}</p>
        </header>
        <table className="id-table">
          <thead><tr><th colSpan={2}>{content.heading.title}</th></tr></thead>
          <tbody>
            <tr><td>Título do Projeto</td><td className="shade">{content.heading.project}</td></tr>
            <tr><td>Bolsista:</td><td>{content.heading.scholar}</td></tr>
            <tr><td>Vigência da Bolsa:</td><td className="shade"><b>{content.heading.scholarshipPeriod}</b></td></tr>
            <tr><td>RTP Nº:</td><td>{content.heading.number}</td></tr>
          </tbody>
        </table>
        {sectionTitles.map(([key, title, chapter]) => <div key={key}>
          {chapter && <h2>{chapter}</h2>}
          <section className="sec">
            <div className="sec-head">{title ? <h3>{title}</h3> : <span />}{!locked && <div className="sec-tools"><button className="btn btn-sm btn-quiet" disabled={!!busy} onClick={() => regenerate(key)}><RefreshCw />{busy === `regen-${key}` ? 'Regenerando…' : 'Regenerar seção'}</button></div>}</div>
            <AutoText value={content.sections[key]} onChange={(v) => setSection(key, v)} label={title || chapter!} readOnly={locked} />
          </section>
        </div>)}
        {content.pending.length > 0 && <div className="pending-box"><b>Pendente de confirmação ({content.pending.length})</b>Sem registro de execução no período. Este quadro não sai no arquivo exportado.<ul>{content.pending.map((p) => <li key={p.activity}>{p.activity}</li>)}</ul></div>}
        <div className="signature"><p className="place">{content.closing.placeAndDate}</p><div>{content.closing.scholar}</div><div>{content.closing.role}</div></div>
      </article></div>

      <aside className="side">
        <div className="panel">
          <h3>Situação</h3>
          <ol className="flow-state">{flow.map((s, i) => <li key={s} data-state={i < stage ? 'done' : i === stage ? 'current' : undefined}>{statusLabel(s)}</li>)}</ol>
          {canManage && (report.status === 'approved' || report.status === 'exported') && <>
            <button className="btn btn-block" style={{ marginTop: 12 }} disabled={!!busy} onClick={() => {
              const reason = prompt('Motivo da reabertura (fica no histórico de auditoria). A aprovação será retirada e o RTP voltará a rascunho para edição:');
              if (reason && reason.trim().length >= 5) void act('reopen', () => reportsApi.reopen(id!, reason), 'RTP reaberto para edição.');
              else if (reason !== null) toast('Informe o motivo com ao menos 5 caracteres.', 'crit');
            }}>Reabrir para edição</button>
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Aprovado e bloqueado para edição. Reabrir retira a aprovação.</p>
          </>}
          {canManage && report.status === 'draft' && <button className="btn btn-block" style={{ marginTop: 12 }} disabled={dirty || !!busy} onClick={() => act('submit', () => reportsApi.submit(id!), 'Enviado para revisão.')}>Enviar para revisão</button>}
          {canManage && (report.status === 'draft' || report.status === 'pending_review') && <>
            <button className="btn btn-go btn-block" style={{ marginTop: 8 }} disabled={critical.length > 0 || dirty || !!busy} onClick={() => act('approve', () => reportsApi.approve(id!), 'RTP aprovado.')}><Check />Aprovar RTP</button>
            {critical.length > 0 && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Aprovação bloqueada: {critical.length} inconsistência(s) crítica(s) sem resolução.</p>}
            {dirty && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Salve a versão antes de aprovar.</p>}
          </>}
        </div>
        <div className="panel">
          <h3>Validação</h3>
          {open.length ? <><p style={{ fontSize: 14 }}>{critical.length} crítica(s), {open.filter((v) => v.severity === 'attention').length} de atenção, {open.filter((v) => v.severity === 'suggestion').length} sugestão(ões).</p><button className="btn btn-sm btn-quiet" style={{ marginTop: 6, paddingLeft: 0 }} onClick={() => setTab('validation')}>Ver achados</button></> : <p style={{ fontSize: 14 }} className="muted">Nenhum achado em aberto.</p>}
        </div>
        <div className="panel">
          <h3>Exportar</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            <button className="btn btn-block" disabled={dirty || !!busy} onClick={() => file('docx')}><Download />{busy === 'docx' ? 'Gerando…' : 'DOCX editável'}</button>
            <button className="btn btn-block" disabled={dirty || !!busy} onClick={() => file('pdf')}><Download />{busy === 'pdf' ? 'Gerando…' : 'PDF final'}</button>
          </div>
          {report.status !== 'approved' && report.status !== 'exported' && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Antes da aprovação, os arquivos servem como prévia.</p>}
        </div>
      </aside>
    </div>}

    {tab === 'validation' && <section className="panel">
      <div className="panel-head"><div><h2>Validação automática</h2><p>Consistência documental, temporal e de resultados. Achados críticos bloqueiam a aprovação até serem corrigidos ou justificados.</p></div></div>
      <div className="panel-pad" style={{ paddingTop: 4 }}>{(report.validations ?? []).length ? (report.validations ?? []).map((v) => <Finding key={v.id} v={v} canResolve={canManage && !locked} onResolve={(note) => act(`resolve-${v.id}`, () => reportsApi.resolve(id!, v.id, note), 'Achado resolvido com justificativa.')} />) : <Notice tone="ok">Nenhuma inconsistência foi identificada nesta versão.</Notice>}</div>
    </section>}

    {tab === 'versions' && <section className="panel">
      <div className="panel-head"><div><h2>Versões</h2><p>Cada salvamento, regeneração ou restauração cria uma versão nova. Nenhuma é apagada.</p></div></div>
      <ul className="versions">{report.versions?.map((v) => <li key={v.version}>
        <b>v{v.version}</b>
        <div>{v.change_summary || 'Sem descrição'}<small>{new Date(v.created_at).toLocaleString('pt-BR')}{v.version === report.current_version ? ', versão atual' : ''}</small></div>
        {v.version !== report.current_version && <div className="head-actions">
          <button className="btn btn-sm btn-quiet" onClick={() => setCompare(compare === v.version ? null : v.version)}>{compare === v.version ? 'Fechar comparação' : 'Comparar com a atual'}</button>
          {!locked && <button className="btn btn-sm" disabled={!!busy} onClick={() => { if (confirm(`Restaurar o conteúdo da versão ${v.version}? Uma nova versão será criada.`)) void act('restore', () => reportsApi.save(id!, v.content, `Restaurada a partir da v${v.version}`), `Versão ${v.version} restaurada.`); }}>Restaurar</button>}
        </div>}
      </li>)}</ul>
      {compare !== null && (() => { const old = report.versions!.find((v) => v.version === compare)!.content; return sectionTitles.map(([k, title, chapter]) => <div className="compare" key={k}>
        <div className={old.sections[k] !== report.content!.sections[k] ? 'changed' : ''}><h4>v{compare}, {title || chapter}</h4>{old.sections[k]}</div>
        <div className={old.sections[k] !== report.content!.sections[k] ? 'changed' : ''}><h4>Atual (v{report.current_version})</h4>{report.content!.sections[k]}</div>
      </div>); })()}
    </section>}
  </>;
}

function Finding({ v, canResolve, onResolve }: { v: Validation; canResolve: boolean; onResolve: (note: string) => Promise<void> }) {
  const [open, setOpen] = useState(false), [note, setNote] = useState('');
  const t = v.resolved_at ? 'ok' : v.severity === 'critical' ? 'crit' : 'warn';
  return <div className="finding" data-tone={t}>
    {v.resolved_at ? <Check /> : <AlertTriangle />}
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><b>{v.message}</b><Tag status={v.severity} /></div>
      <small>{v.location}, código {v.code}</small>
      {v.resolved_at && <small>Resolvido em {fmt(v.resolved_at)}: {v.resolution_note}</small>}
      {!v.resolved_at && canResolve && (open
        ? <form className="resolve" onSubmit={async (e) => { e.preventDefault(); await onResolve(note); setOpen(false); }}><input required minLength={10} value={note} onChange={(e) => setNote(e.target.value)} placeholder="O que foi verificado ou corrigido" autoFocus /><button className="btn btn-sm btn-primary">Registrar</button><button type="button" className="btn btn-sm btn-quiet" onClick={() => setOpen(false)}>Cancelar</button></form>
        : <div className="resolve"><button className="btn btn-sm" onClick={() => setOpen(true)}>Marcar como resolvido</button></div>)}
    </div>
  </div>;
}
