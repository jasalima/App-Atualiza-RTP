import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { AlertTriangle, Download, Eye, FileArchive, FileImage, FileSpreadsheet, FileText, History, Plane, Trash2, Upload, X } from 'lucide-react';
import { documents as documentsApi, reports as reportsApi, scholars as scholarsApi, travelReports, type DocumentMeta } from '../api';
import type { DeliveryStatus, DocumentDetail, ProjectDocument, Report, ScholarOverview, TravelReport } from '../types';
import SendDocumentButton from '../SendDocumentButton';
import { Drawer, Empty, Notice, PageHead, Skeleton, Tag, errorText, fmt, fmtPeriod, today, useAsync, useScope, useToast } from '../ui';

export const CATEGORIES: Record<string, string> = {
  work_plan: 'Plano de Trabalho', evidence: 'Evidência de execução', contract: 'Contrato ou termo', minutes: 'Ata',
  official_letter: 'Ofício ou memorando', invoice: 'Nota fiscal ou recibo', certificate: 'Certidão ou declaração',
  technical: 'Produto técnico ou estudo', report: 'Relatório', other: 'Outro'
};
// Categories a person can choose when uploading; plans and evidence come from their own flows.
const UPLOADABLE = Object.keys(CATEGORIES).filter((c) => c !== 'work_plan');
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.odt,.ods,.odp,.ppt,.pptx,.csv,.txt,.rtf,.png,.jpg,.jpeg,.webp,.heic,.zip';
const size = (n: number) => (n < 1048576 ? `${Math.max(1, Math.ceil(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
const daysUntil = (d: string) => Math.round((new Date(`${d}T12:00:00Z`).getTime() - new Date(`${today()}T12:00:00Z`).getTime()) / 86400000);
const validity = (d: string | null) => {
  if (!d) return null;
  const n = daysUntil(d);
  return n < 0 ? { tone: 'crit' as const, text: `Vencido há ${-n} dia(s)` } : n <= 30 ? { tone: 'warn' as const, text: n === 0 ? 'Vence hoje' : `Vence em ${n} dia(s)` } : { tone: 'mute' as const, text: `Válido até ${fmt(d)}` };
};
const iconFor = (mime: string, name: string) => /image/.test(mime) ? FileImage : /sheet|excel|csv/.test(mime) || /\.(xlsx?|ods|csv)$/i.test(name) ? FileSpreadsheet : /zip/.test(mime) ? FileArchive : FileText;
// Send state shown in the archive so a document is not sent twice. An RTP counts as sent
// only when its current version went out.
type SendState = { tone: 'ok' | 'warn' | 'info' | 'mute'; text: string; sent: boolean; when?: string };
function sendState(d: DeliveryStatus | undefined, currentVersion?: number): SendState {
  const when = d?.sentAt ? new Date(d.sentAt).toLocaleDateString('pt-BR') : undefined;
  if (d?.sentAt && currentVersion && (d.sentVersion ?? 0) < currentVersion) return { tone: 'warn', text: 'Nova versão pendente de envio', sent: false, when };
  if (d?.sentAt) return { tone: 'ok', text: 'Enviado ao bolsista', sent: true, when };
  if (d?.sending) return { tone: 'info', text: 'Enviando', sent: false };
  if (d?.uncertain) return { tone: 'warn', text: 'Conferir envio no WhatsApp', sent: false };
  return { tone: 'mute', text: 'Pendente de envio', sent: false };
}
function SendTag({ state }: { state: SendState }) {
  return <span className="send-state"><Tag tone={state.tone}>{state.text}</Tag>{state.when && <small>em {state.when}</small>}</span>;
}
const stem = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

type Source = 'all' | 'files' | 'rtp' | 'travel';
type Sent = 'all' | 'sent' | 'pending';
type Row =
  | { type: 'file'; key: string; date: string; doc: ProjectDocument }
  | { type: 'rtp'; key: string; date: string; report: Report }
  | { type: 'travel'; key: string; date: string; travel: TravelReport };

export default function Documents() {
  const { project, user, canManage } = useScope(), toast = useToast(), projectId = project!.id;
  const data = useAsync(() => Promise.all([documentsApi.list(projectId), reportsApi.list(projectId).catch(() => [] as Report[]), travelReports.list(projectId).catch(() => [] as TravelReport[]), scholarsApi.list(projectId)]), [projectId]);
  const [q, setQ] = useState(''), [category, setCategory] = useState(''), [member, setMember] = useState(''), [source, setSource] = useState<Source>('all');
  const [uploading, setUploading] = useState<{ replaces?: ProjectDocument } | null>(null), [detail, setDetail] = useState<string | null>(null);
  const deliveries = useAsync(() => documentsApi.deliveries(projectId), [projectId]);
  const [sent, setSent] = useState<Sent>('all');
  const sentMap = useMemo(() => new Map((deliveries.data ?? []).map((d) => [`${d.kind}:${d.id}`, d])), [deliveries.data]);
  const stateOf = (r: Row) => r.type === 'file' ? sendState(sentMap.get(`document:${r.doc.id}`)) : r.type === 'rtp' ? sendState(sentMap.get(`rtp:${r.report.id}`), r.report.current_version) : sendState(sentMap.get(`travel:${r.travel.id}`));
  const refreshSent = () => void deliveries.reload();
  const [files, reports, travel, members] = data.data ?? [[], [], [], []] as [ProjectDocument[], Report[], TravelReport[], ScholarOverview[]];

  const rows = useMemo<Row[]>(() => [
    ...files.map((doc) => ({ type: 'file' as const, key: `f${doc.id}`, date: doc.updatedAt, doc })),
    ...reports.map((report) => ({ type: 'rtp' as const, key: `r${report.id}`, date: report.updated_at ?? report.issued_on, report })),
    ...travel.map((t) => ({ type: 'travel' as const, key: `t${t.id}`, date: t.updatedAt, travel: t }))
  ].sort((a, b) => String(b.date).localeCompare(String(a.date))), [files, reports, travel]);

  const filtered = rows.filter((r) => {
    if (source !== 'all' && (source === 'files' ? r.type !== 'file' : r.type !== source)) return false;
    if (category && (r.type !== 'file' || r.doc.category !== category)) return false;
    const scholarId = r.type === 'file' ? r.doc.scholarId : r.type === 'rtp' ? r.report.scholar_id : r.travel.scholarId;
    if (member && scholarId !== member) return false;
    if (sent !== 'all' && deliveries.data && stateOf(r).sent !== (sent === 'sent')) return false;
    const text = r.type === 'file' ? `${r.doc.title} ${r.doc.originalName} ${r.doc.description} ${r.doc.scholarName ?? ''}` : r.type === 'rtp' ? `RTP ${r.report.number} ${r.report.scholar_name ?? ''}` : `relatório de viagem ${r.travel.destination} ${r.travel.scholarName ?? ''}`;
    return !q || text.toLocaleLowerCase('pt-BR').includes(q.toLocaleLowerCase('pt-BR'));
  });

  const expiring = files.filter((d) => d.validUntil && daysUntil(d.validUntil) <= 30).sort((a, b) => String(a.validUntil).localeCompare(String(b.validUntil)));
  const used = files.reduce((n, d) => n + d.size, 0);
  const counts = files.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.category]: (acc[d.category] ?? 0) + 1 }), {});

  return <>
    <PageHead title="Documentos do projeto" description="Acervo único do projeto: planos, evidências, contratos, atas, ofícios e demais arquivos, além dos RTPs e relatórios de viagem. Cada acesso e envio fica registrado."
      actions={<button className="btn btn-primary" onClick={() => setUploading({})}><Upload />Enviar documentos</button>} />
    {data.error ? <Notice tone="crit" title="Não foi possível carregar os documentos">{data.error}<p><button className="btn" onClick={() => void data.reload()}>Tentar novamente</button></p></Notice> : !data.data ? <Skeleton /> : <div className="stack">
      <div className="tally">
        <div><b>{files.length}</b><span>arquivos no acervo</span></div>
        <div><b>{reports.length}</b><span>RTPs</span></div>
        <div><b>{travel.length}</b><span>relatórios de viagem</span></div>
        <div data-tone={expiring.length ? 'warn' : undefined}><b>{expiring.length}</b><span>vencidos ou a vencer em 30 dias</span></div>
      </div>

      {expiring.length > 0 && <section className="panel">
        <div className="panel-head"><div><h2>Validade dos documentos</h2><p>Documentos com prazo vencido ou próximo do vencimento.</p></div></div>
        <ul className="checks">{expiring.map((d) => { const v = validity(d.validUntil)!; return <li key={d.id}><div>{d.title}<small>{CATEGORIES[d.category]}{d.scholarName ? `, ${d.scholarName}` : ''}</small></div><span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Tag tone={v.tone}>{v.text}</Tag><button className="btn btn-sm" onClick={() => setDetail(d.id)}>Abrir</button></span></li>; })}</ul>
      </section>}

      <section className="panel">
        <div className="doc-chips" role="toolbar" aria-label="Filtrar por categoria">
          <button className={!category ? 'chip active' : 'chip'} onClick={() => setCategory('')}>Todas <em>{files.length}</em></button>
          {Object.entries(CATEGORIES).filter(([c]) => counts[c]).map(([c, label]) => <button key={c} className={category === c ? 'chip active' : 'chip'} onClick={() => { setCategory(category === c ? '' : c); setSource('all'); }}>{label} <em>{counts[c]}</em></button>)}
        </div>
        <div className="toolbar">
          <input className="grow" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título, nome do arquivo, descrição ou membro" aria-label="Buscar documento" />
          <select value={source} onChange={(e) => setSource(e.target.value as Source)} aria-label="Origem"><option value="all">Tudo</option><option value="files">Arquivos</option><option value="rtp">RTPs</option><option value="travel">Relatórios de viagem</option></select>
          <select value={sent} onChange={(e) => setSent(e.target.value as Sent)} aria-label="Situação de envio"><option value="all">Enviados e pendentes</option><option value="sent">Já enviados</option><option value="pending">Pendentes de envio</option></select>
          {canManage && <select value={member} onChange={(e) => setMember(e.target.value)} aria-label="Membro"><option value="">Todos os membros</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select>}
          <span className="muted" style={{ fontSize: 13 }}>{filtered.length} item(ns), {size(used)} em arquivos</span>
        </div>
        <div className="table-wrap"><table className="ledger doc-table">
          <thead><tr><th>Documento</th><th>Categoria</th><th>Membro</th><th>Situação</th><th>Envio</th><th>Atualizado</th><th aria-label="Ações" /></tr></thead>
          <tbody>{filtered.map((r) => r.type === 'file' ? <FileRow key={r.key} doc={r.doc} projectId={projectId} onOpen={() => setDetail(r.doc.id)} send={stateOf(r)} onSent={refreshSent} />
            : r.type === 'rtp' ? <tr key={r.key}>
              <td><NavLink className="doc-name" to={`/reports/${r.report.id}`}><FileText /><span><b>RTP {r.report.number}</b><small>{fmtPeriod(r.report.period_start, r.report.period_end)}</small></span></NavLink></td>
              <td><Tag tone="info">Relatório Técnico Parcial</Tag></td><td>{r.report.scholar_name}</td><td><Tag status={r.report.status} /></td><td><SendTag state={stateOf(r)} /></td><td className="num">{fmt(r.date)}</td>
              <td><div className="row-actions"><SendDocumentButton iconOnly source={{ kind: 'rtp', id: r.report.id, label: `RTP ${r.report.number}`, scholarId: r.report.scholar_id }} onSent={refreshSent} /></div></td></tr>
            : <tr key={r.key}>
              <td><NavLink className="doc-name" to={`/travel/${r.travel.id}`}><Plane /><span><b>Relatório de viagem{r.travel.destination ? ` a ${r.travel.destination}` : ''}</b><small>{r.travel.departureDate ? fmtPeriod(r.travel.departureDate, r.travel.returnDate) : 'Datas a preencher'}</small></span></NavLink></td>
              <td><Tag tone="info">Formulário 26</Tag></td><td>{r.travel.scholarName}</td><td><Tag tone={r.travel.status === 'finalized' ? 'ok' : 'info'}>{r.travel.status === 'finalized' ? 'Concluído' : 'Em preenchimento'}</Tag></td><td><SendTag state={stateOf(r)} /></td><td className="num">{fmt(r.date)}</td>
              <td><div className="row-actions"><SendDocumentButton iconOnly source={{ kind: 'travel', id: r.travel.id, label: `Formulário 26 — ${r.travel.scholarName}`, scholarId: r.travel.scholarId }} onSent={refreshSent} /></div></td></tr>)}</tbody>
        </table></div>
        {!filtered.length && <Empty title={rows.length ? 'Nenhum documento encontrado' : 'Acervo vazio'} action={!rows.length && <button className="btn btn-primary" onClick={() => setUploading({})}><Upload />Enviar documentos</button>}>{rows.length ? 'Ajuste a busca ou os filtros.' : 'Envie contratos, atas, ofícios, notas e demais arquivos do projeto. Planos importados, evidências, RTPs e relatórios de viagem aparecem aqui automaticamente.'}</Empty>}
      </section>
    </div>}

    {uploading && <UploadDrawer projectId={projectId} members={canManage ? members : members.filter((m) => m.id === user.scholarId)} canManage={canManage} replaces={uploading.replaces}
      onClose={() => setUploading(null)} onDone={(n) => { setUploading(null); toast(n === 1 ? 'Documento enviado.' : `${n} documentos enviados.`); void data.reload(); }} />}
    {detail && <DetailDrawer projectId={projectId} id={detail} members={members} canManage={canManage} userId={user.id}
      onClose={() => setDetail(null)} onChanged={() => { void data.reload(); refreshSent(); }} onNewVersion={(doc) => { setDetail(null); setUploading({ replaces: doc }); }} />}
  </>;
}

function FileRow({ doc, projectId, onOpen, send, onSent }: { doc: ProjectDocument; projectId: string; onOpen: () => void; send: SendState; onSent: () => void }) {
  const toast = useToast(), Icon = iconFor(doc.mimeType, doc.originalName), v = validity(doc.validUntil);
  const open = (mode: 'view' | 'download') => documentsApi.open(projectId, doc.id, mode).catch((e) => toast(errorText(e), 'crit'));
  return <tr>
    <td><button className="doc-name" onClick={onOpen}><Icon /><span><b>{doc.title}</b><small>{doc.originalName}, {size(doc.size)}</small></span></button></td>
    <td><Tag tone={doc.category === 'work_plan' || doc.category === 'evidence' ? 'ok' : 'mute'}>{CATEGORIES[doc.category] ?? doc.category}</Tag></td>
    <td>{doc.scholarName ?? <span className="muted">Projeto</span>}</td>
    <td>{v ? <Tag tone={v.tone}>{v.text}</Tag> : doc.versions > 1 ? <Tag tone="info">Versão {doc.version}</Tag> : <span className="muted">—</span>}</td>
    <td><SendTag state={send} /></td>
    <td className="num">{fmt(doc.updatedAt)}</td>
    <td><div className="row-actions">
      <button className="icon-btn" onClick={() => void open('view')} aria-label={`Visualizar ${doc.title}`} title="Visualizar"><Eye /></button>
      <button className="icon-btn" onClick={() => void open('download')} aria-label={`Baixar ${doc.title}`} title="Baixar"><Download /></button>
      <SendDocumentButton iconOnly source={{ kind: 'document', id: doc.id, label: doc.title, scholarId: doc.scholarId }} onSent={onSent} />
      <button className="icon-btn" onClick={onOpen} aria-label={`Detalhes de ${doc.title}`} title="Detalhes, versões e histórico"><History /></button>
    </div></td>
  </tr>;
}

type Pending = { file: File; meta: DocumentMeta; progress: number; state: 'ready' | 'sending' | 'done' | 'failed'; error?: string };

function UploadDrawer({ projectId, members, canManage, replaces, onClose, onDone }: { projectId: string; members: ScholarOverview[]; canManage: boolean; replaces?: ProjectDocument; onClose: () => void; onDone: (n: number) => void }) {
  const [items, setItems] = useState<Pending[]>([]), [over, setOver] = useState(false), [busy, setBusy] = useState(false);
  const defaultMember = canManage ? (replaces?.scholarId ?? null) : (members[0]?.id ?? null);
  const add = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    setItems((cur) => [...cur, ...picked.filter((f) => !cur.some((c) => c.file.name === f.name && c.file.size === f.size)).map((file) => ({
      file, progress: 0, state: 'ready' as const,
      meta: replaces ? { title: replaces.title, category: replaces.category, description: replaces.description, scholarId: replaces.scholarId, validUntil: replaces.validUntil }
        : { title: stem(file.name), category: 'other', description: '', scholarId: defaultMember, validUntil: null }
    }))].slice(0, replaces ? 1 : 20));
  };
  const patch = (i: number, p: Partial<Pending>) => setItems((cur) => cur.map((x, n) => (n === i ? { ...x, ...p } : x)));
  const meta = (i: number, p: Partial<DocumentMeta>) => setItems((cur) => cur.map((x, n) => (n === i ? { ...x, meta: { ...x.meta, ...p } } : x)));
  async function send() {
    setBusy(true);
    let ok = 0;
    for (const [i, item] of items.entries()) {
      if (item.state === 'done') { ok++; continue; }
      patch(i, { state: 'sending', error: undefined, progress: 0 });
      try { await documentsApi.upload(projectId, item.file, item.meta, replaces?.id ?? null, (progress) => patch(i, { progress })); patch(i, { state: 'done', progress: 1 }); ok++; }
      catch (e) { patch(i, { state: 'failed', error: errorText(e) }); }
    }
    setBusy(false);
    if (ok === items.length) onDone(ok);
  }
  const allValid = items.length > 0 && items.every((x) => x.meta.title.trim().length >= 2);
  return <Drawer open onClose={() => !busy && onClose()} title={replaces ? 'Enviar nova versão' : 'Enviar documentos'} description={replaces ? `Substitui a versão ${replaces.version} de “${replaces.title}”. As versões anteriores continuam guardadas.` : 'Os arquivos vão para o armazenamento privado do projeto. Até 50 MB por arquivo e 20 arquivos por vez.'}>
    <label className="drop" data-over={over} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
      <Upload /><b>{replaces ? 'Escolha o arquivo da nova versão' : 'Arraste os arquivos aqui ou clique para escolher'}</b><small>PDF, Word, Excel, LibreOffice, imagens, CSV, TXT ou ZIP</small>
      <input type="file" accept={ACCEPT} multiple={!replaces} onChange={(e) => { add(e.target.files); e.target.value = ''; }} disabled={busy} />
    </label>
    <div className="upload-list">{items.map((item, i) => <div className="upload-item" key={`${item.file.name}${item.file.size}`} data-state={item.state}>
      <div className="upload-head"><b>{item.file.name}</b><small>{size(item.file.size)}</small>{item.state === 'ready' && !busy && <button className="icon-btn" onClick={() => setItems((cur) => cur.filter((_, n) => n !== i))} aria-label={`Remover ${item.file.name}`}><X /></button>}</div>
      {!replaces && <div className="grid-form">
        <label className="field span-2">Título<input value={item.meta.title} onChange={(e) => meta(i, { title: e.target.value })} disabled={item.state !== 'ready' && item.state !== 'failed'} /></label>
        <label className="field">Categoria<select value={item.meta.category} onChange={(e) => meta(i, { category: e.target.value })} disabled={item.state === 'sending' || item.state === 'done'}>{UPLOADABLE.map((c) => <option key={c} value={c}>{CATEGORIES[c]}</option>)}</select></label>
        <label className="field">Validade<input type="date" value={item.meta.validUntil ?? ''} onChange={(e) => meta(i, { validUntil: e.target.value || null })} disabled={item.state === 'sending' || item.state === 'done'} /><small>Opcional: contratos, certidões, termos</small></label>
        {canManage && <label className="field span-2">Membro<select value={item.meta.scholarId ?? ''} onChange={(e) => meta(i, { scholarId: e.target.value || null })} disabled={item.state === 'sending' || item.state === 'done'}><option value="">Documento do projeto (sem membro)</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select></label>}
        <label className="field span-2">Descrição<input value={item.meta.description} onChange={(e) => meta(i, { description: e.target.value })} placeholder="Opcional" disabled={item.state === 'sending' || item.state === 'done'} /></label>
      </div>}
      {item.state !== 'ready' && <div className="progress" aria-label={`Progresso de ${item.file.name}`}><i style={{ width: `${Math.round(item.progress * 100)}%` }} /></div>}
      {item.state === 'done' && <small className="ok-text">Enviado e registrado</small>}
      {item.error && <Notice tone="crit">{item.error}</Notice>}
    </div>)}</div>
    {items.length > 1 && !replaces && !busy && <div className="apply-all">
      <span>Aplicar a todos:</span>
      <select onChange={(e) => { const v = e.target.value; if (v) setItems((cur) => cur.map((x) => x.state === 'done' ? x : { ...x, meta: { ...x.meta, category: v } })); e.target.value = ''; }} defaultValue="" aria-label="Categoria para todos"><option value="">Categoria…</option>{UPLOADABLE.map((c) => <option key={c} value={c}>{CATEGORIES[c]}</option>)}</select>
      {canManage && <select onChange={(e) => { const v = e.target.value; setItems((cur) => cur.map((x) => x.state === 'done' ? x : { ...x, meta: { ...x.meta, scholarId: v === '__project' ? null : v } })); e.target.value = ''; }} defaultValue="" aria-label="Membro para todos"><option value="">Membro…</option><option value="__project">Documento do projeto</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select>}
    </div>}
    <div className="form-foot" style={{ marginTop: 16 }}><button className="btn btn-quiet" onClick={onClose} disabled={busy}>Fechar</button><button className="btn btn-primary" disabled={busy || !allValid} onClick={() => void send()}>{busy ? 'Enviando…' : items.some((x) => x.state === 'failed') ? 'Tentar novamente' : replaces ? 'Enviar nova versão' : `Enviar ${items.length || ''} arquivo(s)`}</button></div>
  </Drawer>;
}

const ACTIONS: Record<string, string> = { upload: 'Enviou', new_version: 'Enviou nova versão', edit: 'Editou os dados', delete: 'Excluiu', view: 'Visualizou', download: 'Baixou', import: 'Importou', send_document: 'Enviou pelo WhatsApp' };

function DetailDrawer({ projectId, id, members, canManage, userId, onClose, onChanged, onNewVersion }: { projectId: string; id: string; members: ScholarOverview[]; canManage: boolean; userId: string; onClose: () => void; onChanged: () => void; onNewVersion: (doc: ProjectDocument) => void }) {
  const toast = useToast();
  const detail = useAsync<DocumentDetail>(() => documentsApi.detail(projectId, id), [projectId, id]);
  const [form, setForm] = useState<DocumentMeta | null>(null), [busy, setBusy] = useState(false);
  const d = detail.data?.document;
  const editable = !!d && (canManage || d.createdBy === userId) && d.category !== 'work_plan';
  const current: DocumentMeta | null = form ?? (d ? { title: d.title, category: d.category, description: d.description, scholarId: d.scholarId, validUntil: d.validUntil } : null);
  async function save() {
    setBusy(true);
    try { await documentsApi.update(projectId, id, current!); toast('Dados do documento salvos.'); setForm(null); void detail.reload(); onChanged(); }
    catch (e) { toast(errorText(e), 'crit'); } finally { setBusy(false); }
  }
  async function remove() {
    const reason = prompt(`Excluir “${d!.title}”${d!.versions > 1 ? ` e suas ${d!.versions} versões` : ''}? O registro permanece na auditoria.\n\nInforme o motivo:`);
    if (reason === null) return;
    if (reason.trim().length < 5) return toast('Informe o motivo com ao menos 5 caracteres.', 'crit');
    try { await documentsApi.remove(projectId, id, reason); toast('Documento excluído.'); onChanged(); onClose(); } catch (e) { toast(errorText(e), 'crit'); }
  }
  const open = (docId: string, mode: 'view' | 'download') => documentsApi.open(projectId, docId, mode).catch((e) => toast(errorText(e), 'crit'));
  return <Drawer open onClose={onClose} title={d?.title ?? 'Documento'} description={d ? `${CATEGORIES[d.category] ?? d.category}, versão ${d.version}` : undefined}>
    {detail.error ? <Notice tone="crit">{detail.error}</Notice> : !d || !current ? <Skeleton /> : <div className="stack" style={{ gap: 20 }}>
      <div className="head-actions">
        <button className="btn" onClick={() => void open(d.id, 'view')}><Eye />Visualizar</button>
        <button className="btn" onClick={() => void open(d.id, 'download')}><Download />Baixar</button>
        <SendDocumentButton source={{ kind: 'document', id: d.id, label: d.title, scholarId: d.scholarId }} onSent={() => { onChanged(); void detail.reload(); }} />
        {editable && <button className="btn" onClick={() => onNewVersion(d)}><Upload />Nova versão</button>}
      </div>

      {(() => { const v = validity(d.validUntil); return v && v.tone !== 'mute' && <Notice tone={v.tone === 'crit' ? 'crit' : 'warn'} title={v.text}>Envie a versão atualizada quando o documento for renovado.</Notice>; })()}

      <div className="grid-form">
        <label className="field span-2">Título<input value={current.title} onChange={(e) => setForm({ ...current, title: e.target.value })} disabled={!editable} /></label>
        <label className="field">Categoria<select value={current.category} onChange={(e) => setForm({ ...current, category: e.target.value })} disabled={!editable}>{(d.category === 'work_plan' ? Object.keys(CATEGORIES) : UPLOADABLE).map((c) => <option key={c} value={c}>{CATEGORIES[c]}</option>)}</select></label>
        <label className="field">Validade<input type="date" value={current.validUntil ?? ''} onChange={(e) => setForm({ ...current, validUntil: e.target.value || null })} disabled={!editable} /></label>
        {canManage && <label className="field span-2">Membro<select value={current.scholarId ?? ''} onChange={(e) => setForm({ ...current, scholarId: e.target.value || null })} disabled={!editable}><option value="">Documento do projeto (sem membro)</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select></label>}
        <label className="field span-2">Descrição<textarea value={current.description} onChange={(e) => setForm({ ...current, description: e.target.value })} disabled={!editable} /></label>
        {editable && form && <div className="form-foot span-2"><button className="btn btn-quiet" onClick={() => setForm(null)}>Descartar</button><button className="btn btn-primary" disabled={busy || current.title.trim().length < 2} onClick={() => void save()}>{busy ? 'Salvando…' : 'Salvar dados'}</button></div>}
      </div>

      <dl className="facts">
        <div><dt>Arquivo</dt><dd>{d.originalName}</dd></div><div><dt>Tamanho</dt><dd>{size(d.size)}</dd></div>
        <div><dt>Registrado em</dt><dd>{fmt(d.createdAt)}</dd></div><div><dt>Integridade (SHA-256)</dt><dd className="hash" title={d.sha256}>{d.sha256.slice(0, 16)}…</dd></div>
      </dl>

      <section>
        <h3 className="drawer-sub">Versões</h3>
        <ul className="versions compact">{detail.data!.versions.map((v) => <li key={v.id}><b>v{v.version}</b><div>{v.originalName}<small>{fmt(v.createdAt)}, {size(v.size)}{v.id === d.id ? ', atual' : ''}</small></div><div className="row-actions"><button className="icon-btn" onClick={() => void open(v.id, 'view')} aria-label={`Visualizar versão ${v.version}`}><Eye /></button><button className="icon-btn" onClick={() => void open(v.id, 'download')} aria-label={`Baixar versão ${v.version}`}><Download /></button></div></li>)}</ul>
      </section>

      <section>
        <h3 className="drawer-sub">Envios pelo WhatsApp</h3>
        {detail.data!.deliveries.length ? <ul className="checks">{detail.data!.deliveries.map((x, i) => <li key={i}><div>Para {x.recipient}<small>{new Date(x.createdAt).toLocaleString('pt-BR')}</small></div><Tag tone={x.status === 'accepted' ? 'ok' : x.status === 'failed' ? 'crit' : 'warn'}>{x.status === 'accepted' ? 'Enviado' : x.status === 'failed' ? 'Falhou' : x.status === 'sending' ? 'Enviando' : 'A confirmar'}</Tag></li>)}</ul> : <p className="muted" style={{ fontSize: 13.5 }}>Nenhum envio registrado.</p>}
      </section>

      <section>
        <h3 className="drawer-sub">Histórico</h3>
        {detail.data!.audit.length ? <ul className="audit-list">{detail.data!.audit.map((a, i) => <li key={i}><time>{new Date(a.created_at).toLocaleString('pt-BR')}</time><span><b>{a.who}</b> {(ACTIONS[a.action] ?? a.action).toLocaleLowerCase('pt-BR')}{a.metadata?.reason ? `: ${String(a.metadata.reason)}` : ''}</span></li>)}</ul> : <p className="muted" style={{ fontSize: 13.5 }}>Sem registros.</p>}
      </section>

      {editable && <div><button className="btn btn-quiet btn-danger" onClick={() => void remove()}><Trash2 />Excluir documento</button></div>}
      {d.category === 'work_plan' && <p className="muted" style={{ fontSize: 13 }}><AlertTriangle size={14} style={{ verticalAlign: '-2px' }} /> Planos de Trabalho são substituídos importando uma nova versão em <NavLink to="/plans">Planos de Trabalho</NavLink>.</p>}
    </div>}
  </Drawer>;
}
