import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import {
  Archive, ArrowDown, ArrowLeft, ArrowUp, Check, Copy, CopyPlus, Download, ExternalLink, FilePlus2, FileSignature, FileText, ListPlus, Lock, Paperclip,
  PenLine, Plus, RotateCcw, Send, ShieldCheck, Trash2, UserPlus, X
} from 'lucide-react';
import { minutes as minutesApi, signatures } from '../api';
import type { MinuteDraft, MinuteListItem, MinuteParticipant, MinuteTopic, MinuteView, ParticipantCandidate, RichDoc } from '../types';
import { ATTENDANCE_LABEL, STATUS_LABEL, autoClosing, autoIntro, dateShort, docText, emptyDoc, type MinuteDisplayStatus } from '@/lib/minutes-model';
import RichEditor from '../RichEditor';
import { Drawer, Empty, Notice, PageHead, Skeleton, Tag, errorText, useAsync, useScope, useToast } from '../ui';

const TONE: Record<MinuteDisplayStatus, 'ok' | 'info' | 'warn' | 'crit' | 'mute'> = { draft: 'mute', editing: 'info', finalized: 'info', awaiting: 'warn', partial: 'warn', signed: 'ok', archived: 'mute', cancelled: 'crit' };
const when = (iso: string | null | undefined) => iso ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(iso)) : '—';
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const newId = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2));

/** Confirms the deletion; with signatures (administration only) a reason is required. Returns the reason, or null if cancelled. */
async function confirmDelete(number: string, signed: boolean): Promise<string | null> {
  if (!signed) return confirm(`Excluir ${number}? Os arquivos da ata serão apagados; fica apenas o registro de auditoria.`) ? '' : null;
  const reason = prompt(`${number} já tem assinaturas. Ao excluí-la, as assinaturas são canceladas e a verificação pública passa a mostrar “Documento cancelado”. Informe o motivo:`);
  if (reason === null) return null;
  if (reason.trim().length < 5) { alert('Informe o motivo (ao menos 5 caracteres).'); return null; }
  return reason.trim();
}

/* List ---------------------------------------------------------------------------------------- */
export function MinutesList() {
  const { project, user } = useScope(), toast = useToast(), navigate = useNavigate(), projectId = project!.id;
  async function remove(m: MinuteListItem) {
    const ok = await confirmDelete(m.number, m.signatures.signed > 0);
    if (ok === null) return;
    try { await minutesApi.status(m.id, 'delete', ok); toast(`${m.number} excluída.`); await list.reload(); } catch (e) { toast(errorText(e), 'crit'); }
  }
  const list = useAsync(() => minutesApi.list(projectId), [projectId]);
  const [q, setQ] = useState(''), [status, setStatus] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [creating, setCreating] = useState(false);
  const rows = useMemo(() => (list.data ?? []).filter((m) => {
    if (status && m.displayStatus !== status) return false;
    if (from && (!m.meetingDate || m.meetingDate < from)) return false;
    if (to && (!m.meetingDate || m.meetingDate > to)) return false;
    if (!q.trim()) return true;
    const hay = norm([m.number, m.title, m.subject, m.chairedBy, m.draftedBy, ...m.participants, m.meetingDate ? dateShort(m.meetingDate) : ''].join(' '));
    return norm(q).split(/\s+/).every((w) => hay.includes(w));
  }), [list.data, q, status, from, to]);
  const count = (s: MinuteDisplayStatus[]) => (list.data ?? []).filter((m) => s.includes(m.displayStatus)).length;
  async function create() {
    setCreating(true);
    try { const r = await minutesApi.create(projectId); toast(`${r.number} criada.`); navigate(`/atas/${r.id}`); }
    catch (e) { toast(errorText(e), 'crit'); setCreating(false); }
  }
  return <>
    <PageHead title="Atas de Reunião" description="Elabore a ata no modelo institucional, colha as assinaturas de todos os participantes ao mesmo tempo e compartilhe o PDF com QR Code de autenticidade."
      actions={<button className="btn btn-primary" disabled={creating} onClick={() => void create()}><FilePlus2 />{creating ? 'Criando…' : 'Nova ata'}</button>} />
    {list.error ? <Notice tone="crit">{list.error}</Notice> : !list.data ? <Skeleton /> : <>
      <div className="tally">
        <div><b>{list.data.length}</b><span>Atas no projeto</span></div>
        <div><b>{count(['draft', 'editing'])}</b><span>Em elaboração</span></div>
        <div data-tone={count(['awaiting', 'partial']) ? 'warn' : undefined}><b>{count(['awaiting', 'partial'])}</b><span>Aguardando assinaturas</span></div>
        <div><b>{count(['signed'])}</b><span>Totalmente assinadas</span></div>
      </div>
      <div className="panel">
        <div className="toolbar">
          <input className="grow" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número, assunto, participante ou responsável" aria-label="Buscar atas" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação"><option value="">Todas as situações</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <label className="toolbar-date">De<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="toolbar-date">Até<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {!rows.length ? <Empty title={list.data.length ? 'Nenhuma ata com esses filtros' : 'Nenhuma ata registrada'}>{list.data.length ? 'Ajuste a busca ou a situação.' : 'Crie a primeira ata do projeto pelo botão “Nova ata”.'}</Empty> :
          <div className="table-wrap"><table className="ledger">
            <thead><tr><th>Ata</th><th>Assunto</th><th>Reunião</th><th>Responsável</th><th>Assinaturas</th><th>Situação</th><th aria-label="Abrir" /></tr></thead>
            <tbody>{rows.map((m) => <tr key={m.id}>
              <td className="num"><b>{m.number}</b>{m.version && <small className="muted" style={{ display: 'block' }}>versão {m.version}</small>}</td>
              <td><b>{m.subject || <span className="muted">Sem assunto</span>}</b><small className="muted" style={{ display: 'block' }}>{m.participants.length ? `${m.participants.length} participante(s): ${m.participants.slice(0, 3).join(', ')}${m.participants.length > 3 ? '…' : ''}` : 'Participantes não informados'}</small></td>
              <td className="num">{m.meetingDate ? dateShort(m.meetingDate) : '—'}</td>
              <td>{m.chairedBy || m.draftedBy || '—'}</td>
              <td className="num">{m.signatures.total ? <Progress done={m.signatures.signed} total={m.signatures.total} compact /> : '—'}</td>
              <td><Tag tone={TONE[m.displayStatus]}>{STATUS_LABEL[m.displayStatus]}</Tag></td>
              <td><div className="row-actions"><NavLink className="btn btn-sm" to={`/atas/${m.id}`}>Abrir</NavLink>{(m.signatures.signed === 0 || user.role === 'admin') && <button className="icon-btn icon-danger" title={m.signatures.signed ? 'Excluir (administração)' : 'Excluir'} aria-label={`Excluir ${m.number}`} onClick={() => void remove(m)}><Trash2 /></button>}</div></td>
            </tr>)}</tbody>
          </table></div>}
      </div>
    </>}
  </>;
}

function Progress({ done, total, compact }: { done: number; total: number; compact?: boolean }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return <div className={compact ? 'sig-progress sig-progress-compact' : 'sig-progress'}>
    <span>{compact ? `${done}/${total}` : <><b>{done} de {total}</b> assinaturas concluídas — {pct}%</>}</span>
    <i role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Assinaturas concluídas"><em style={{ width: `${pct}%` }} /></i>
  </div>;
}

/* Editor ---------------------------------------------------------------------------------------- */
export function MinuteEditor() {
  const { id } = useParams(), toast = useToast(), navigate = useNavigate(), { canManage, user } = useScope();
  const [view, setView] = useState<MinuteView | null>(null), [error, setError] = useState('');
  const [draft, setDraft] = useState<MinuteDraft | null>(null), [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const candidates = useAsync(() => (view ? minutesApi.participants(view.projectId) : Promise.resolve([] as ParticipantCandidate[])), [view?.projectId]);
  const load = useCallback(async () => {
    try { const v = await minutesApi.get(id!); setView(v); setDraft(v.draft); setDirty(false); setError(''); }
    catch (e) { setError(errorText(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const editable = !!view && view.canEdit && ['draft', 'editing'].includes(view.status);
  const change = (patch: Partial<MinuteDraft>) => { setDraft((d) => (d ? { ...d, ...patch } : d)); setDirty(true); };

  // Autosave two seconds after the last change; one save at a time.
  const saving$ = useRef(false), latest = useRef(draft);
  latest.current = draft;
  const save = useCallback(async (quiet = false) => {
    if (!latest.current || saving$.current) return false;
    saving$.current = true; setSaving(true);
    const sent = latest.current;
    try { const r = await minutesApi.save(id!, sent); setSavedAt(r.savedAt); if (latest.current === sent) setDirty(false); if (!quiet) toast('Ata salva.'); return true; }
    catch (e) { toast(errorText(e), 'crit'); return false; }
    finally { saving$.current = false; setSaving(false); }
  }, [id, toast]);
  useEffect(() => { if (!dirty || !editable) return; const t = setTimeout(() => void save(true), 2000); return () => clearTimeout(t); }, [draft, dirty, editable, save]);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { if (dirty && editable && !(await save(true))) return; await fn(); toast(done); await load(); }
    catch (e) { toast(errorText(e), 'crit'); } finally { setBusy(false); }
  }
  const upload = (asImage: boolean) => async (file: File) => (await minutesApi.upload(id!, file, asImage)).src;
  // The preview is shown inside the app (no pop-up to be blocked), always from the saved draft.
  async function openPreview() { if (dirty && editable && !(await save(true))) return; setPreview(`${minutesApi.pdfUrl(id!)}${minutesApi.pdfUrl(id!).includes('?') ? '&' : '?'}t=${Date.now()}#view=FitH`); }
  function sendNow() { setSending(true); return act(() => minutesApi.send(id!), 'Solicitação criada: os participantes estão recebendo a ata.').finally(() => setSending(false)); }

  if (error) return <div className="stack"><Notice tone="crit" title="Não foi possível abrir a ata">{error}</Notice><div><NavLink className="btn" to="/atas">Voltar às atas</NavLink></div></div>;
  if (!view || !draft) return <Skeleton />;
  const request = view.request, version = view.version;
  const openRequest = request && ['pending', 'completed'].includes(request.status) ? request : null;
  const signedCount = openRequest?.signers.filter((s) => s.status === 'signed').length ?? 0;
  const signers = draft.participants.filter((p) => p.signs);

  return <>
    <header className="minute-bar">
      <NavLink to="/atas" className="minute-bar-back" aria-label="Voltar às Atas de Reunião"><ArrowLeft /></NavLink>
      <div className="minute-bar-id">
        <div className="minute-bar-title"><h1>{view.number}</h1><Tag tone={TONE[view.displayStatus]}>{STATUS_LABEL[view.displayStatus]}</Tag>{version && <span className="minute-bar-code" title="Código de verificação">v{version.version} · {version.publicCode}</span>}</div>
        <p>{draft.subject || <span className="muted">Defina o assunto da reunião</span>}</p>
      </div>
      <div className="minute-bar-actions">
        {editable && <span className="minute-bar-save" aria-live="polite">{saving ? 'Salvando…' : dirty ? 'Alterações não salvas' : savedAt ? `Salvo às ${new Date(savedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Tudo salvo'}</span>}
        {editable && <button className="btn" disabled={saving || !dirty} onClick={() => void save()}><Check />Salvar</button>}
        <button className="btn" onClick={() => void openPreview()}><FileText />{editable ? 'Pré-visualizar' : 'Ver PDF'}</button>
        <a className="btn" href={minutesApi.pdfUrl(view.id, true)} onClick={(e) => { if (dirty && editable) { e.preventDefault(); void save(true).then((ok) => { if (ok) window.location.href = minutesApi.pdfUrl(view.id, true); }); } }}><Download />Baixar PDF</a>
        {editable && <button className="btn btn-primary" disabled={busy} onClick={() => { if (confirm('Finalizar congela o conteúdo da ata (versão, hash e código de verificação). Alterações depois exigem reabrir a edição. Continuar?')) void act(() => minutesApi.finalize(view.id), 'Ata finalizada. Agora você pode encaminhá-la para assinatura.'); }}><Lock />Finalizar ata</button>}
        {view.status === 'finalized' && !openRequest && view.canEdit && <button className="btn btn-primary" disabled={busy || sending || !signers.length} onClick={() => void sendNow()}><Send />{sending ? 'Encaminhando…' : 'Encaminhar para assinatura'}</button>}
      </div>
    </header>
    {preview && <div className="pdf-modal" role="dialog" aria-modal="true" aria-label={`Pré-visualização de ${view.number}`} onKeyDown={(e) => e.key === 'Escape' && setPreview(null)}>
      <div className="pdf-modal-box">
        <div className="pdf-modal-head"><b>{view.number}{editable ? ' — minuta' : ''}</b><div className="head-actions"><a className="btn btn-sm" href={preview} target="_blank" rel="noreferrer"><ExternalLink />Nova aba</a><a className="btn btn-sm" href={minutesApi.pdfUrl(view.id, true)}><Download />Baixar</a><button className="btn btn-sm" autoFocus onClick={() => setPreview(null)}><X />Fechar</button></div></div>
        <iframe title={`PDF de ${view.number}`} src={preview} />
      </div>
    </div>}
    {view.status === 'cancelled' && <div style={{ marginBottom: 16 }}><Notice tone="crit" title="Ata cancelada">{view.statusReason}</Notice></div>}
    {!view.canEdit && ['draft', 'editing'].includes(view.status) && <div style={{ marginBottom: 16 }}><Notice tone="info">Somente quem criou a ata ou a coordenação do projeto pode alterá-la.</Notice></div>}
    {!editable && ['finalized', 'archived'].includes(view.status) && <div style={{ marginBottom: 16 }}><Notice tone="info" title="Conteúdo congelado">A versão {version?.version} foi emitida com o hash SHA-256 e o código {version?.publicCode}. Para corrigir o texto, reabra a edição: a versão atual passa a constar como substituída.</Notice></div>}

    <div className="split minute-split">
      <div className="stack">
        <Section title="Identificação da reunião">
          <div className="grid-form">
            <label className="field span-2">Assunto<input value={draft.subject} disabled={!editable} onChange={(e) => change({ subject: e.target.value })} placeholder="Ex.: Alinhamento do Produto 1.3 – Mapeamento Cartográfico e Geoespacial do Polo" /></label>
            <label className="field span-2">Título do documento<input value={draft.title} disabled={!editable} onChange={(e) => change({ title: e.target.value })} /></label>
            <label className="field">Data<input type="date" value={draft.meetingDate ?? ''} disabled={!editable} onChange={(e) => change({ meetingDate: e.target.value || null })} /></label>
            <div className="grid-pair">
              <label className="field">Início<input type="time" value={draft.startsAt ?? ''} disabled={!editable} onChange={(e) => change({ startsAt: e.target.value || null })} /></label>
              <label className="field">Encerramento<input type="time" value={draft.endsAt ?? ''} disabled={!editable} onChange={(e) => change({ endsAt: e.target.value || null })} /></label>
            </div>
            <label className="field">Modalidade<select value={draft.modality} disabled={!editable} onChange={(e) => change({ modality: e.target.value as MinuteDraft['modality'] })}><option value="online">On-line</option><option value="presencial">Presencial</option><option value="hibrida">Híbrida</option></select></label>
            {draft.modality !== 'presencial' && <label className="field">Plataforma de videoconferência<input value={draft.platform} disabled={!editable} list="platforms" onChange={(e) => change({ platform: e.target.value })} /><datalist id="platforms"><option value="Google Meet" /><option value="Microsoft Teams" /><option value="Zoom" /><option value="RNP Conferência Web" /></datalist></label>}
            {draft.modality !== 'online' && <label className="field">Local<input value={draft.location} disabled={!editable} onChange={(e) => change({ location: e.target.value })} placeholder="Ex.: Sala de reuniões da Reitoria – UFT" /></label>}
            <label className="field">Responsável pela reunião<input value={draft.chairedBy} disabled={!editable} list="people" onChange={(e) => change({ chairedBy: e.target.value })} /></label>
            <label className="field">Responsável pela elaboração<input value={draft.draftedBy} disabled={!editable} list="people" onChange={(e) => change({ draftedBy: e.target.value })} /><small>Aparece no encerramento: “e eu, …, lavrei a presente ata”.</small></label>
            <datalist id="people">{(candidates.data ?? []).map((c) => <option key={c.name} value={c.name} />)}</datalist>
            <label className="field span-2">Objetivo da reunião<textarea value={draft.objective} disabled={!editable} onChange={(e) => change({ objective: e.target.value })} rows={2} placeholder="Ex.: alinhar escopo, prazo, forma de contratação e equipe responsável pelo Produto 1.3" /></label>
            <label className="field">Cidade da assinatura<input value={draft.place} disabled={!editable} onChange={(e) => change({ place: e.target.value })} /><small>Ex.: “Palmas, TO, 04 de novembro de 2026.”</small></label>
          </div>
        </Section>

        <Participants draft={draft} candidates={candidates.data ?? null} editable={editable} onChange={(participants) => change({ participants })} />

        <AutoText title="Abertura" hint="Escrita a partir da data, do horário, da modalidade, dos presentes e do objetivo." value={draft.intro} auto={() => autoIntro(draft, view.projectTitle)} editable={editable} onChange={(intro) => change({ intro })} upload={upload(true)} />

        <Topics topics={draft.topics} editable={editable} onChange={(topics) => change({ topics })} upload={upload(true)} />

        <Section title="Decisões e encaminhamentos" hint="Use o menu “Quadros…” para inserir o quadro de encaminhamentos, cronograma, responsabilidades ou financeiro.">
          <RichEditor label="Decisões e encaminhamentos" value={draft.decisions} editable={editable} onChange={(decisions) => change({ decisions })} onUpload={upload(true)} />
        </Section>

        <Section title="Próxima reunião">
          <div className="grid-form">
            <label className="field">Data<input type="date" value={draft.nextMeeting.date ?? ''} disabled={!editable} onChange={(e) => change({ nextMeeting: { ...draft.nextMeeting, date: e.target.value || null } })} /></label>
            <label className="field">Horário<input type="time" value={draft.nextMeeting.time ?? ''} disabled={!editable} onChange={(e) => change({ nextMeeting: { ...draft.nextMeeting, time: e.target.value || null } })} /></label>
            <label className="field span-2">Observações<textarea rows={2} value={draft.nextMeeting.notes} disabled={!editable} onChange={(e) => change({ nextMeeting: { ...draft.nextMeeting, notes: e.target.value } })} placeholder="Sem data, o documento registra: “Não foi definida data nesta reunião.”" /></label>
          </div>
        </Section>

        <AutoText title="Encerramento" hint="Escrito a partir do horário de encerramento e de quem elaborou a ata." value={draft.closing} auto={() => autoClosing(draft)} editable={editable} onChange={(closing) => change({ closing })} />

        <Attachments draft={draft} minuteId={view.id} editable={editable} onChange={(attachments) => change({ attachments })} />

        <Section title="Cabeçalho do documento" hint="Copiado da última ata do projeto. Altere se a reunião for de outra unidade." collapsible>
          <div className="grid-form">
            {[0, 1].map((i) => <label className="field span-2" key={i}>{i === 0 ? 'Instituição' : 'Projeto'}<input value={draft.header.lines[i] ?? ''} disabled={!editable} onChange={(e) => { const lines = [...draft.header.lines]; lines[i] = e.target.value; change({ header: { ...draft.header, lines } }); }} /></label>)}
            <label className="field span-2">Endereço e contatos<input value={draft.header.address} disabled={!editable} onChange={(e) => change({ header: { ...draft.header, address: e.target.value } })} /></label>
            <label className="field span-2">Rodapé<input value={draft.header.footer} disabled={!editable} onChange={(e) => change({ header: { ...draft.header, footer: e.target.value } })} /><small>Seguido do número da ata e de “Página N de M”.</small></label>
          </div>
        </Section>
      </div>

      <aside className="side">
        <div className="panel panel-pad">
          <h3>Situação</h3>
          <dl className="facts">
            <div><dt>Número</dt><dd>{view.number}</dd></div>
            <div><dt>Situação</dt><dd>{STATUS_LABEL[view.displayStatus]}</dd></div>
            {version && <div><dt>Versão emitida</dt><dd>{version.version} · {when(version.issuedAt)}</dd></div>}
            {version && <div><dt>Código de verificação</dt><dd><code>{version.publicCode}</code></dd></div>}
            <div><dt>Última alteração</dt><dd>{when(savedAt ?? view.updatedAt)}</dd></div>
          </dl>
          {version && <a className="btn btn-block" style={{ marginTop: 12 }} href={`/verificar-documento/${version.publicCode}`} target="_blank" rel="noreferrer"><ShieldCheck />Página de verificação</a>}
        </div>

        {openRequest ? <SignatureControl request={openRequest} busy={busy} canManage={canManage} onAct={act} />
          : view.status === 'finalized' && <div className="panel panel-pad stack" style={{ gap: 12 }}>
            <h3><FileSignature size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />Encaminhar para assinatura</h3>
            {request?.status === 'rejected' && <Notice tone="crit" title="Assinatura recusada">{request.closedReason}</Notice>}
            {request?.status === 'cancelled' && <Notice tone="mute" title="Solicitação anterior cancelada">{request.closedReason}</Notice>}
            {signers.length ? <ul className="signer-list">{signers.map((p) => { const c = candidates.data?.find((x) => x.authUserId === p.authUserId); return <li key={p.authUserId}><b>{p.name}</b><small>{[p.role, p.institution].filter(Boolean).join(' · ') || '—'}</small><small>{c?.email || p.email || 'sem e-mail'}{c?.pendingFirstAccess ? ' · primeiro acesso pendente' : ''}</small></li>; })}</ul>
              : <Notice tone="warn">Nenhum signatário marcado. Reabra a edição e marque “Assina” nos participantes presentes.</Notice>}
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>Todos recebem a ata ao mesmo tempo, pelo seu WhatsApp, e assinam em qualquer ordem pelo link. Cada assinatura registra nome, CPF, data, hora, IP e o hash SHA-256 da versão {version?.version}.</p>
            <button className="btn btn-primary btn-block" disabled={busy || sending || !signers.length} onClick={() => void sendNow()}><Send />{sending ? 'Encaminhando…' : `Encaminhar para ${signers.length} signatário(s)`}</button>
          </div>}

        {view.canEdit && <div className="panel panel-pad stack" style={{ gap: 8 }}>
          <h3>Ações</h3>
          {['finalized'].includes(view.status) && <button className="btn btn-block" disabled={busy} onClick={() => {
            const signed = signedCount > 0;
            const reason = signed ? prompt('A ata já tem assinaturas. Reabrir cancela as assinaturas e a versão atual passa a constar como substituída. Informe o motivo:') : (confirm('Reabrir a edição? A versão emitida passa a constar como substituída e um novo código será gerado ao finalizar.') ? '' : null);
            if (reason !== null) void act(() => minutesApi.reopen(view.id, reason), 'Edição reaberta.');
          }}><RotateCcw />Reabrir edição</button>}
          {view.status === 'finalized' && <button className="btn btn-block" disabled={busy} onClick={() => void act(() => minutesApi.status(view.id, 'archive'), 'Ata arquivada.')}><Archive />Arquivar</button>}
          {view.status === 'archived' && <button className="btn btn-block" disabled={busy} onClick={() => void act(() => minutesApi.status(view.id, 'unarchive'), 'Ata desarquivada.')}><Archive />Desarquivar</button>}
          {(signedCount === 0 || user.role === 'admin') && <button className="btn btn-quiet btn-block btn-danger" disabled={busy} onClick={() => { void confirmDelete(view.number, signedCount > 0).then((reason) => { if (reason !== null) minutesApi.status(view.id, 'delete', reason).then(() => { toast(`${view.number} excluída.`); navigate('/atas'); }, (e) => toast(errorText(e), 'crit')); }); }}><Trash2 />Excluir ata</button>}
          {view.manager && version && view.status !== 'cancelled' && <button className="btn btn-quiet btn-block btn-danger" disabled={busy} onClick={() => { const reason = prompt('Cancelar a ata? A página de verificação passará a mostrar “Documento cancelado”. Informe o motivo:'); if (reason !== null) void act(() => minutesApi.status(view.id, 'cancel', reason), 'Ata cancelada.'); }}><X />Cancelar ata</button>}
        </div>}
      </aside>
    </div>
  </>;
}

function Section({ title, hint, children, actions, collapsible }: { title: string; hint?: string; children: ReactNode; actions?: ReactNode; collapsible?: boolean }) {
  const body = <><div className="panel-head"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div>{actions}</div><div className="panel-pad">{children}</div></>;
  return collapsible ? <details className="panel minute-section"><summary className="panel-head"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div></summary><div className="panel-pad">{children}</div></details> : <section className="panel minute-section">{body}</section>;
}

/** Opening and closing paragraphs: written from the fields until someone edits them by hand. */
function AutoText({ title, hint, value, auto, editable, onChange, upload }: { title: string; hint: string; value: RichDoc | null; auto: () => RichDoc; editable: boolean; onChange: (d: RichDoc | null) => void; upload?: (f: File) => Promise<string> }) {
  const [key, setKey] = useState(0);
  return <Section title={title} hint={value ? 'Texto editado manualmente.' : hint} actions={editable && (value
    ? <button className="btn btn-sm" onClick={() => { if (confirm('Voltar ao texto automático? A versão editada será descartada.')) { onChange(null); setKey((k) => k + 1); } }}><RotateCcw />Texto automático</button>
    : <button className="btn btn-sm" onClick={() => { onChange(auto()); setKey((k) => k + 1); }}><PenLine />Editar manualmente</button>)}>
    {value ? <RichEditor key={key} label={title} value={value} editable={editable} onChange={onChange} onUpload={upload} /> : <p className="auto-text">{autoRender(auto())}</p>}
  </Section>;
}
const autoRender = (d: RichDoc) => (d.content[0]?.content ?? []).map((n, i) => n.marks?.some((m) => m.type === 'bold') ? <b key={i}>{n.text}</b> : <span key={i}>{n.text}</span>);

/* Participants --------------------------------------------------------------------------------- */
function Participants({ draft, candidates, editable, onChange }: { draft: MinuteDraft; candidates: ParticipantCandidate[] | null; editable: boolean; onChange: (p: MinuteParticipant[]) => void }) {
  const [guest, setGuest] = useState(false);
  const keyOf = (p: { scholarId: string | null; authUserId: string | null; name: string }) => p.scholarId ?? p.authUserId ?? `guest:${p.name}`;
  const selected = new Map(draft.participants.map((p) => [keyOf(p), p]));
  const update = (key: string, patch: Partial<MinuteParticipant>) => onChange(draft.participants.map((p) => {
    if (keyOf(p) !== key) return p;
    const next = { ...p, ...patch };
    if (!['present', 'guest'].includes(next.attendance) || !next.authUserId) next.signs = false;
    return next;
  }));
  const toggle = (c: ParticipantCandidate) => {
    const k = keyOf(c);
    if (selected.has(k)) onChange(draft.participants.filter((p) => keyOf(p) !== k));
    else onChange([...draft.participants, { scholarId: c.scholarId, authUserId: c.authUserId, name: c.name, institution: c.institution, role: c.role, email: c.email, attendance: 'present', signs: !!c.authUserId }]);
  };
  const guests = draft.participants.filter((p) => !candidates?.some((c) => keyOf(c) === keyOf(p)));
  const present = draft.participants.filter((p) => p.attendance === 'present' || p.attendance === 'guest').length;
  const row = (key: string, p: MinuteParticipant | null, c: ParticipantCandidate | null) => {
    const on = !!p, name = p?.name ?? c!.name;
    return <tr key={key} className={on ? undefined : 'row-off'}>
      <td className="col-pick"><input type="checkbox" className="pick" checked={on} disabled={!editable || !c} onChange={() => c && toggle(c)} aria-label={`Incluir ${name} na ata`} /></td>
      <td className="col-person"><b>{name}</b><small>{c ? `${c.registration}${c.email ? ` · ${c.email}` : ''}` : 'Convidado externo'}</small></td>
      <td>{on ? <input value={p!.institution} disabled={!editable} onChange={(e) => update(key, { institution: e.target.value })} placeholder="Ex.: UFT" aria-label={`Instituição de ${name}`} /> : <span className="muted">{c?.institution || '—'}</span>}</td>
      <td>{on ? <input value={p!.role} disabled={!editable} onChange={(e) => update(key, { role: e.target.value })} aria-label={`Função de ${name}`} /> : <span className="muted">{c?.role || '—'}</span>}</td>
      <td>{on && <select value={p!.attendance} disabled={!editable} onChange={(e) => update(key, { attendance: e.target.value as MinuteParticipant['attendance'] })} aria-label={`Situação de ${name}`}>
        {(c ? ['present', 'absent', 'justified'] : ['guest', 'absent', 'justified']).map((a) => <option key={a} value={a}>{ATTENDANCE_LABEL[a as MinuteParticipant['attendance']]}</option>)}
      </select>}</td>
      <td>{on && <label className="sign-toggle" title={!p!.authUserId ? 'Sem acesso ao sistema: crie um acesso de assinatura em Configurações.' : undefined}><input type="checkbox" checked={p!.signs} disabled={!editable || !p!.authUserId || !['present', 'guest'].includes(p!.attendance)} onChange={(e) => update(key, { signs: e.target.checked })} aria-label={`${name} assina`} /><span>{p!.authUserId ? 'Assina' : 'Sem acesso'}</span></label>}</td>
      <td>{on && editable && !c && <button className="icon-btn" aria-label={`Remover ${name}`} onClick={() => onChange(draft.participants.filter((x) => keyOf(x) !== key))}><X /></button>}</td>
    </tr>;
  };
  return <section className="panel minute-section">
    <div className="panel-head"><div><h2>Participantes</h2><p>Marque quem esteve na reunião (o cadastro de cada pessoa não é alterado). {present} presente(s), {draft.participants.filter((p) => p.signs).length} assinam.</p></div>
      {editable && candidates && <div className="head-actions">
        <button className="btn btn-sm" onClick={() => onChange([...draft.participants, ...candidates.filter((c) => !selected.has(keyOf(c))).map((c) => ({ scholarId: c.scholarId, authUserId: c.authUserId, name: c.name, institution: c.institution, role: c.role, email: c.email, attendance: 'present' as const, signs: !!c.authUserId }))])}><ListPlus />Incluir todos</button>
        <button className="btn btn-sm" onClick={() => onChange(draft.participants.map((p) => ({ ...p, signs: !!p.authUserId && ['present', 'guest'].includes(p.attendance) })))}><FileSignature />Presentes assinam</button>
        <button className="btn btn-sm btn-quiet" onClick={() => onChange([])}>Limpar</button>
      </div>}
    </div>
    {!candidates ? <div className="panel-pad"><Skeleton /></div> : <div className="table-wrap"><table className="ledger participants">
      <thead><tr><th className="col-pick"><span className="sr-only">Incluir</span></th><th>Pessoa</th><th>Instituição</th><th>Cargo ou função</th><th>Situação</th><th>Assinatura</th><th aria-label="Remover" /></tr></thead>
      <tbody>
        {candidates.map((c) => row(keyOf(c), selected.get(keyOf(c)) ?? null, c))}
        {guests.map((p) => row(keyOf(p), p, null))}
      </tbody>
    </table></div>}
    {editable && <div className="panel-pad" style={{ paddingTop: 12 }}><button className="btn btn-sm" onClick={() => setGuest(true)}><UserPlus />Adicionar convidado externo</button></div>}
    {guest && <GuestDrawer onClose={() => setGuest(false)} onAdd={(p) => { onChange([...draft.participants, p]); setGuest(false); }} />}
  </section>;
}
function GuestDrawer({ onClose, onAdd }: { onClose: () => void; onAdd: (p: MinuteParticipant) => void }) {
  const [p, setP] = useState({ name: '', institution: '', role: '', email: '' });
  return <Drawer open onClose={onClose} title="Convidado externo" description="Pessoa que participou sem estar cadastrada no projeto. Para assinar, ela precisa de um acesso de assinatura (Configurações).">
    <form className="stack" onSubmit={(e) => { e.preventDefault(); onAdd({ scholarId: null, authUserId: null, ...p, attendance: 'guest', signs: false }); }}>
      <label className="field">Nome completo<input required value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
      <label className="field">Instituição<input value={p.institution} onChange={(e) => setP({ ...p, institution: e.target.value })} /></label>
      <label className="field">Cargo ou função<input value={p.role} onChange={(e) => setP({ ...p, role: e.target.value })} /></label>
      <label className="field">E-mail<input type="email" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} /></label>
      <div className="form-foot"><button type="button" className="btn btn-quiet" onClick={onClose}>Cancelar</button><button className="btn btn-primary"><UserPlus />Adicionar</button></div>
    </form>
  </Drawer>;
}

/* Topics ---------------------------------------------------------------------------------------- */
function Topics({ topics, editable, onChange, upload }: { topics: MinuteTopic[]; editable: boolean; onChange: (t: MinuteTopic[]) => void; upload: (f: File) => Promise<string> }) {
  const blank = (): MinuteTopic => ({ id: newId(), title: '', body: emptyDoc(), children: [] });
  const clone = (t: MinuteTopic): MinuteTopic => ({ ...JSON.parse(JSON.stringify(t)), id: newId(), children: t.children.map(clone) });
  function edit(list: MinuteTopic[], path: number[], fn: (list: MinuteTopic[], i: number) => MinuteTopic[]): MinuteTopic[] {
    if (path.length === 1) return fn(list, path[0]);
    return list.map((t, i) => (i === path[0] ? { ...t, children: edit(t.children, path.slice(1), fn) } : t));
  }
  const apply = (path: number[], fn: (list: MinuteTopic[], i: number) => MinuteTopic[]) => onChange(edit(topics, path, fn));
  const move = (list: MinuteTopic[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= list.length) return list; const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; return n; };
  const item = (t: MinuteTopic, path: number[], number: string, siblings: number) => {
    const sub = path.length > 1;
    return <div key={t.id} className={sub ? 'topic topic-sub' : 'topic'}>
      <div className="topic-head">
        <span className="topic-n">{number}{sub ? '' : '.'}</span>
        <input className="topic-title" value={t.title} disabled={!editable} placeholder={sub ? 'Título do subtópico' : 'Título do tópico'} aria-label={`Título do ${sub ? 'subtópico' : 'tópico'} ${number}`} onChange={(e) => apply(path, (l, i) => l.map((x, n) => (n === i ? { ...x, title: e.target.value } : x)))} />
        {editable && <div className="topic-tools">
          <button className="icon-btn" title="Subir" aria-label="Subir" disabled={path[path.length - 1] === 0} onClick={() => apply(path, (l, i) => move(l, i, -1))}><ArrowUp /></button>
          <button className="icon-btn" title="Descer" aria-label="Descer" disabled={path[path.length - 1] === siblings - 1} onClick={() => apply(path, (l, i) => move(l, i, 1))}><ArrowDown /></button>
          <button className="icon-btn" title="Duplicar" aria-label="Duplicar" onClick={() => apply(path, (l, i) => [...l.slice(0, i + 1), clone(l[i]), ...l.slice(i + 1)])}><CopyPlus /></button>
          {!sub && <button className="icon-btn" title="Inserir subtópico" aria-label="Inserir subtópico" onClick={() => apply(path, (l, i) => l.map((x, n) => (n === i ? { ...x, children: [...x.children, blank()] } : x)))}><Plus /></button>}
          <button className="icon-btn" title="Excluir" aria-label="Excluir" onClick={() => { if (!docText(t.body).trim() && !t.children.length || confirm(`Excluir “${t.title || number}”${t.children.length ? ' e seus subtópicos' : ''}?`)) apply(path, (l, i) => l.filter((_, n) => n !== i)); }}><Trash2 /></button>
        </div>}
      </div>
      <RichEditor label={`Texto do ${sub ? 'subtópico' : 'tópico'} ${number}`} value={t.body} editable={editable} onUpload={upload} onChange={(body) => apply(path, (l, i) => l.map((x, n) => (n === i ? { ...x, body } : x)))} />
      {t.children.map((c, j) => item(c, [...path, j], `${number}.${j + 1}`, t.children.length))}
    </div>;
  };
  return <Section title="Pauta e tópicos" hint="A numeração é atualizada automaticamente ao incluir, mover ou excluir tópicos.">
    <div className="topics">
      {!topics.length && <p className="muted">Nenhum tópico ainda. Cada ponto de pauta vira um tópico numerado no documento.</p>}
      {topics.map((t, i) => item(t, [i], `${i + 1}`, topics.length))}
      {editable && <div><button className="btn" onClick={() => onChange([...topics, blank()])}><Plus />Adicionar tópico</button></div>}
    </div>
  </Section>;
}

/* Annexes --------------------------------------------------------------------------------------- */
function Attachments({ draft, minuteId, editable, onChange }: { draft: MinuteDraft; minuteId: string; editable: boolean; onChange: (a: MinuteDraft['attachments']) => void }) {
  const toast = useToast(), input = useRef<HTMLInputElement>(null), [busy, setBusy] = useState(false);
  const src = (key: string, name?: string) => `/api/minutes/${minuteId}/asset?key=${encodeURIComponent(key)}${name ? `&name=${encodeURIComponent(name)}` : ''}`;
  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const added: MinuteDraft['attachments'] = [];
    try {
      for (const f of Array.from(files)) {
        const image = /^image\/(png|jpe?g|webp)$/.test(f.type);
        const r = await minutesApi.upload(minuteId, f, image);
        added.push({ key: r.key, name: f.name, mime: r.mime, size: r.size, caption: '' });
      }
    } catch (e) { toast(errorText(e), 'crit'); }
    finally { if (added.length) onChange([...draft.attachments, ...added]); setBusy(false); if (input.current) input.current.value = ''; }
  }
  const set = (i: number, patch: Partial<MinuteDraft['attachments'][number]>) => onChange(draft.attachments.map((a, n) => (n === i ? { ...a, ...patch } : a)));
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= draft.attachments.length) return; const n = [...draft.attachments]; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return <Section title="Anexos" hint="Fotografias, capturas de tela e gráficos entram no Anexo I – Registro fotográfico; PDFs e planilhas são listados como documentos complementares."
    actions={editable && <><button className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}><Paperclip />{busy ? 'Enviando…' : 'Anexar arquivos'}</button><input ref={input} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,application/pdf,.docx,.xlsx" onChange={(e) => void add(e.target.files)} /></>}>
    {!draft.attachments.length ? <p className="muted">Nenhum anexo.</p> : <ul className="annexes">{draft.attachments.map((a, i) => <li key={a.key}>
      {a.mime.startsWith('image/') ? <img src={src(a.key)} alt={a.caption || a.name} /> : <a className="annex-file" href={src(a.key, a.name)} target="_blank" rel="noreferrer"><FileText /></a>}
      <div className="annex-body">
        <b>{a.mime.startsWith('image/') ? `Figura ${draft.attachments.slice(0, i + 1).filter((x) => x.mime.startsWith('image/')).length}` : 'Documento complementar'}</b>
        <input value={a.caption} disabled={!editable} onChange={(e) => set(i, { caption: e.target.value })} placeholder={a.mime.startsWith('image/') ? 'Legenda (ex.: Captura de tela da videoconferência realizada em 04/11/2026)' : 'Descrição'} aria-label={`Legenda de ${a.name}`} />
        <small className="muted">{a.name} · {Math.max(1, Math.round(a.size / 1024))} KB</small>
      </div>
      {editable && <div className="topic-tools">
        <button className="icon-btn" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></button>
        <button className="icon-btn" aria-label="Descer" disabled={i === draft.attachments.length - 1} onClick={() => move(i, 1)}><ArrowDown /></button>
        <button className="icon-btn" aria-label={`Remover ${a.name}`} onClick={() => onChange(draft.attachments.filter((_, n) => n !== i))}><Trash2 /></button>
      </div>}
    </li>)}</ul>}
  </Section>;
}

/* Signature control ------------------------------------------------------------------------------ */
function SignatureControl({ request, busy, canManage, onAct }: { request: NonNullable<MinuteView['request']>; busy: boolean; canManage: boolean; onAct: (fn: () => Promise<unknown>, done: string) => Promise<void> }) {
  const toast = useToast(), done = request.signers.filter((s) => s.status === 'signed').length;
  const copy = () => navigator.clipboard.writeText(request.link).then(() => toast('Link de assinatura copiado.'), () => toast(request.link));
  return <div className="panel panel-pad stack" style={{ gap: 12 }}>
    <h3><FileSignature size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />Controle de assinaturas</h3>
    <Progress done={done} total={request.signers.length} />
    <div className="table-wrap"><table className="ledger ledger-tight">
      <thead><tr><th>Participante</th><th>Situação</th><th>Data</th></tr></thead>
      <tbody>{request.signers.map((s) => <tr key={s.id}>
        <td><b>{s.name}</b><small className="muted" style={{ display: 'block' }}>{s.roleLabel}</small></td>
        <td><Tag tone={s.status === 'signed' ? 'ok' : s.status === 'rejected' ? 'crit' : 'warn'}>{s.status === 'signed' ? 'Assinado' : s.status === 'rejected' ? 'Recusou' : 'Pendente'}</Tag>
          {s.status === 'pending' && request.status === 'pending' && canManage && <button className="btn btn-sm btn-quiet" disabled={busy} title="Reenviar pelo WhatsApp" onClick={() => void onAct(async () => { const r = await signatures.notify(request.id, undefined, s.id); toast(`Lembrete enviado para ${r.to}.`); }, 'Reenvio registrado.')}><Send /></button>}</td>
        <td className="num">{s.signedAt ? when(s.signedAt) : '—'}</td>
      </tr>)}</tbody>
    </table></div>
    {request.status === 'completed' && <Notice tone="ok" title="Totalmente assinada">Uma cópia em PDF foi salva em Documentos, na categoria Ata.</Notice>}
    <div style={{ display: 'grid', gap: 8 }}>
      {request.status === 'pending' && <button className="btn btn-block" onClick={() => void copy()}><Copy />Copiar link de assinatura</button>}
      <NavLink className="btn btn-block" to={`/assinar/${request.id}`}><ExternalLink />Abrir página de assinatura</NavLink>
      <a className="btn btn-block" href={signatures.fileUrl(request.id, 'pdf')} target="_blank" rel="noreferrer"><Download />PDF com as assinaturas</a>
      {canManage && request.status === 'pending' && <button className="btn btn-quiet btn-block" disabled={busy} onClick={() => { const reason = prompt('Motivo do cancelamento da solicitação:'); if (reason !== null) void onAct(() => signatures.cancel(request.id, reason), 'Solicitação cancelada.'); }}>Cancelar solicitação</button>}
    </div>
  </div>;
}
