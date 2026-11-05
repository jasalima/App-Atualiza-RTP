import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Copy, Download, ExternalLink, FileSignature, LogOut, PenLine, Send, ShieldCheck, X } from 'lucide-react';
import { scholars as scholarsApi, signatures, users } from '../api';
import type { User, Project, MySignature, ReportContent, SignatureRequest, SignatureSigner, SignerCandidate, SigningView, TravelReport, VerifyResult } from '../types';
import { PhotoManager, TravelFields } from '../TravelFields';
import { Drawer, Empty, Notice, PageHead, Pivot, ScopeContext, Skeleton, Tag, errorText, fmt, useScope, useToast } from '../ui';
import { MinuteEditor, MinutesList } from './Minutes';
import NotificationBell from '../NotificationBell';
import { LEGAL_BASIS, LEGAL_EVIDENCE, LEGAL_TITLE } from '@/lib/legal';

/** Legal basis shown wherever an electronic signature is given or checked. */
export function LegalBasis({ compact }: { compact?: boolean }) {
  return <details className="legal-basis" open={!compact}><summary>{LEGAL_TITLE}</summary><p>{LEGAL_BASIS}</p><p>{LEGAL_EVIDENCE}</p></details>;
}
import Connectivity from './Connectivity';

const when = (iso: string | null) => iso ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(iso)) : '';
const requestTone: Record<SignatureRequest['status'], 'ok' | 'info' | 'warn' | 'crit' | 'mute'> = { pending: 'info', completed: 'ok', rejected: 'crit', cancelled: 'mute' };
const requestText: Record<SignatureRequest['status'], string> = { pending: 'Aguardando assinaturas', completed: 'Assinado por todos', rejected: 'Recusado', cancelled: 'Cancelado' };
const signerText: Record<SignatureSigner['status'], [string, 'ok' | 'info' | 'warn' | 'crit' | 'mute']> = { waiting: ['Na fila', 'mute'], pending: ['Vez de assinar', 'warn'], signed: ['Assinou', 'ok'], rejected: ['Recusou', 'crit'] };
const formatCpf = (v: string) => { const d = v.replace(/\D/g, '').slice(0, 11); return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2'); };
const formatPhone = (raw: string) => { let d = raw.replace(/\D/g, ''); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); return d.length === 11 ? `(${d.slice(0, 2)}) ${d[2]} ${d.slice(3, 7)}-${d.slice(7)}` : raw; };
const br = (d: string | null) => d ? d.split('-').reverse().join('/') : '____/____/______';

/** Banknote-style seal, as printed on the document: green for the beneficiary, gold for the coordination. */
function Seal({ s }: { s: SignatureSigner }) {
  const tone = s.step === 1 ? 'member' : 'coordination', role = s.step === 1 ? 'BENEFICIÁRIO' : 'COORDENAÇÃO DO PROJETO';
  return <div className="seal" data-tone={tone}>
    <div className="seal-band">{`${role} • ASSINATURA ELETRÔNICA • LEI 14.063/2020 • SHA-256 • `.repeat(3)}</div>
    <div className="seal-body">
      <img src={`/seal-${tone}.png`} alt="" width={40} height={40} />
      <div>
        <small>ASSINADO ELETRONICAMENTE POR:</small>
        <b>{s.name.toLocaleUpperCase('pt-BR')}<em>{s.signedAt ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo' }).format(new Date(s.signedAt)).replace(',', ' às') : ''}</em></b>
        <code>Hash: {s.signatureHash}</code>
        <span>IP da máquina: {s.ip || 'não informado'} · horário de Brasília</span>
      </div>
    </div>
    <div className="seal-micro">{'RTP INTELIGENTE • ASSINATURA ELETRÔNICA • LEI 14.063/2020 • SHA-256 • '.repeat(4)}</div>
  </div>;
}

/** Order of signers with their state. */
function Steps({ signers, parallel }: { signers: SignatureSigner[]; parallel?: boolean }) {
  return <ol className="sign-steps">{signers.map((s) => { const [text, tone] = parallel && s.status === 'pending' ? ['Pendente', 'warn' as const] : signerText[s.status]; return <li key={s.id} data-status={s.status}>
    <span className="sign-step-n">{s.status === 'signed' ? <Check /> : s.step}</span>
    <div><b>{s.name}</b><small>{s.roleLabel}</small>{s.signedAt && <small>Assinou em {when(s.signedAt)}{s.cpf ? `, CPF ${s.cpf}` : ''}</small>}{s.rejectReason && <small>Motivo: {s.rejectReason}</small>}</div>
    <Tag tone={tone}>{text}</Tag>
  </li>; })}</ol>;
}

/* Team side: open, follow and cancel the signatures of one document ----------------------------- */
export function SignaturePanel({ kind, sourceId, scholarId, dirty, onLock }: { kind: 'travel' | 'rtp'; sourceId: string; scholarId: string; dirty?: boolean; onLock?: (locked: boolean) => void }) {
  const { project, user, canManage } = useScope(), toast = useToast(), projectId = project!.id;
  const [list, setList] = useState<SignatureRequest[] | null>(null), [error, setError] = useState(''), [opening, setOpening] = useState(false), [busy, setBusy] = useState(false);
  const load = useCallback(() => signatures.forSource(projectId, kind, sourceId).then((l) => { setList(l); setError(''); }, (e) => setError(errorText(e))), [projectId, kind, sourceId]);
  useEffect(() => { void load(); }, [load]);
  const current = list?.find((r) => r.status === 'pending' || r.status === 'completed') ?? null, last = list?.[0] ?? null;
  const locked = !!current && (current.status === 'completed' || current.signers.some((s) => s.status === 'signed'));
  useEffect(() => { onLock?.(locked); }, [locked, onLock]);
  const copy = (link: string) => navigator.clipboard.writeText(link).then(() => toast('Link de assinatura copiado.'), () => toast(link));
  async function act(fn: () => Promise<unknown>, done: string) { setBusy(true); try { await fn(); toast(done); await load(); } catch (e) { toast(errorText(e), 'crit'); } finally { setBusy(false); } }
  const cancel = (r: SignatureRequest) => { const reason = prompt(r.status === 'completed' ? 'Cancelar as assinaturas concluídas permite alterar o documento, que precisará ser assinado de novo. Informe o motivo:' : 'Motivo do cancelamento:'); if (reason !== null) void act(() => signatures.cancel(r.id, reason), 'Solicitação cancelada.'); };
  const notify = (r: SignatureRequest) => void act(async () => { const res = await signatures.notify(r.id); toast(`Link enviado pelo WhatsApp para ${res.to}.`); }, 'Envio registrado.');

  return <div className="panel">
    <h3><FileSignature size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />Assinatura eletrônica</h3>
    {error ? <Notice tone="warn">{error}</Notice> : !list ? <Skeleton /> : <div className="stack" style={{ gap: 12 }}>
      {current ? <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><Tag tone={requestTone[current.status]}>{requestText[current.status]}</Tag>{current.verificationCode && <small className="muted">Código {current.verificationCode}</small>}</div>
        <Steps signers={current.signers} />
        {current.status === 'pending' && <div style={{ display: 'grid', gap: 8 }}>
          <button className="btn btn-block" onClick={() => void copy(current.link)}><Copy />Copiar link de assinatura</button>
          {canManage && <button className="btn btn-block" disabled={busy} onClick={() => notify(current)}><Send />Enviar link pelo WhatsApp</button>}
          <NavLink className="btn btn-block" to={`/assinar/${current.id}`}><ExternalLink />Abrir página de assinatura</NavLink>
        </div>}
        {current.status === 'completed' && <div style={{ display: 'grid', gap: 8 }}>
          <a className="btn btn-go btn-block" href={signatures.fileUrl(current.id, 'pdf')} target="_blank" rel="noreferrer"><Download />Baixar PDF assinado</a>
          <a className="btn btn-block" href={signatures.fileUrl(current.id, 'docx')}><Download />DOCX com assinaturas</a>
          <NavLink className="btn btn-block" to={`/verificar/${current.verificationCode}`}><ShieldCheck />Ver comprovante de verificação</NavLink>
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Uma cópia em PDF também foi salva em Documentos, na categoria Relatório.</p>
        </div>}
        {canManage && <button className="btn btn-quiet btn-block" disabled={busy} onClick={() => cancel(current)}>{current.status === 'completed' ? 'Cancelar assinaturas para alterar' : 'Cancelar solicitação'}</button>}
        {locked && <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Com assinatura registrada, o conteúdo fica bloqueado: qualquer mudança invalidaria o hash assinado.</p>}
      </> : <>
        {last && <Notice tone={last.status === 'rejected' ? 'crit' : 'info'} title={last.status === 'rejected' ? 'Assinatura recusada' : 'Solicitação anterior cancelada'}>{last.closedReason}</Notice>}
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>O membro assina primeiro e a coordenação em seguida, pelo link, sem baixar o documento. Cada assinatura registra nome, CPF, data, hora, IP e o hash SHA-256 do conteúdo.</p>
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>O envio é automático pelo seu WhatsApp: ao solicitar, o membro recebe o documento e o link; assim que ele assina, a coordenação recebe o PDF com a assinatura; quando a coordenação assina, você recebe o PDF final para anexar na prestação de contas da FAPTO.</p>
        {canManage ? <button className="btn btn-primary btn-block" disabled={dirty} onClick={() => setOpening(true)}><PenLine />Solicitar assinaturas</button> : <p className="muted" style={{ fontSize: 13 }}>A coordenação abre a solicitação de assinatura.</p>}
        {dirty && <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Salve as alterações antes de solicitar.</p>}
      </>}
    </div>}
    {opening && <RequestDrawer projectId={projectId} kind={kind} sourceId={sourceId} scholarId={scholarId} isAdmin={user.role === 'admin'} onClose={() => setOpening(false)} onDone={(link) => { setOpening(false); void load(); void copy(link); }} />}
  </div>;
}

function RequestDrawer({ projectId, kind, sourceId, scholarId, isAdmin, onClose, onDone }: { projectId: string; kind: 'travel' | 'rtp'; sourceId: string; scholarId: string; isAdmin: boolean; onClose: () => void; onDone: (link: string) => void }) {
  const toast = useToast();
  const [candidates, setCandidates] = useState<SignerCandidate[] | null>(null), [error, setError] = useState('');
  const [order, setOrder] = useState<string[]>([]), [busy, setBusy] = useState(false), [credential, setCredential] = useState<{ email: string; password: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const list = await signatures.candidates(projectId); setCandidates(list);
      const member = list.find((c) => c.scholarId === scholarId);
      const coord = list.find((c) => c.authUserId !== member?.authUserId && (/coordenador/i.test(c.roleLabel) || c.role === 'coordinator')) ?? list.find((c) => c.authUserId !== member?.authUserId && c.role === 'admin');
      setOrder([member?.authUserId ?? '', coord?.authUserId ?? '']);
    } catch (e) { setError(errorText(e)); }
  }, [projectId, scholarId]);
  useEffect(() => { void load(); }, [load]);
  const memberHasAccount = !!candidates?.some((c) => c.scholarId === scholarId);
  async function createAccess() {
    setBusy(true);
    try {
      const member = (await scholarsApi.list(projectId)).find((s) => s.id === scholarId);
      if (!member?.email) throw new Error('Cadastre o e-mail do membro antes de criar o acesso.');
      const res = await users.create({ name: member.full_name, email: member.email, role: 'signer', projectId, scholarId });
      setCredential({ email: member.email, password: res.temporaryPassword }); await load();
    } catch (e) { toast(errorText(e), 'crit'); } finally { setBusy(false); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try { const res = await signatures.create({ projectId, kind, sourceId, signers: order.filter(Boolean) }); toast('Solicitação criada e link copiado.'); onDone(res.link); }
    catch (x) { toast(errorText(x), 'crit'); } finally { setBusy(false); }
  }
  const chosen = order.filter(Boolean);
  return <Drawer open onClose={() => !busy && onClose()} title="Solicitar assinaturas" description="As pessoas assinam na ordem abaixo. Cada uma recebe a vez depois da anterior.">
    {error ? <Notice tone="crit">{error}</Notice> : !candidates ? <Skeleton /> : <form className="stack" onSubmit={submit}>
      {!memberHasAccount && <Notice tone="warn" title="O membro ainda não tem acesso ao sistema">
        Para assinar pelo link, ele precisa de uma conta. {isAdmin ? 'Crie um acesso “Somente assinatura”: ele verá apenas os documentos enviados para assinatura.' : 'Peça à administração para criar um acesso “Somente assinatura”.'}
        {isAdmin && <p><button type="button" className="btn btn-sm" disabled={busy} onClick={() => void createAccess()}>Criar acesso de assinatura</button></p>}
      </Notice>}
      {credential && <Notice tone="ok" title="Acesso criado">Envie ao membro: e-mail <b>{credential.email}</b> e senha temporária <code>{credential.password}</code>. Ela só aparece agora; no primeiro acesso ele cria a senha definitiva.</Notice>}
      {order.map((value, i) => <label className="field" key={i}>{i === 0 ? '1º — Membro da equipe' : i === 1 ? '2º — Coordenação do projeto' : `${i + 1}º — Signatário adicional`}
        <select value={value} onChange={(e) => setOrder(order.map((v, n) => (n === i ? e.target.value : v)))}>
          <option value="">{i < 2 ? 'Selecione' : 'Ninguém'}</option>
          {candidates.map((c) => <option key={c.authUserId} value={c.authUserId} disabled={order.includes(c.authUserId) && value !== c.authUserId}>{c.name}{c.roleLabel ? ` — ${c.roleLabel}` : ''}{c.pendingFirstAccess ? ' (primeiro acesso pendente)' : ''}</option>)}
        </select></label>)}
      {order.length < 4 && <div><button type="button" className="btn btn-sm" onClick={() => setOrder([...order, ''])}>Adicionar signatário</button></div>}
      <div className="form-foot"><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-primary" disabled={busy || chosen.length < 1 || new Set(chosen).size !== chosen.length}>{busy ? 'Criando…' : 'Criar e copiar link'}</button></div>
    </form>}
  </Drawer>;
}

/* Signer side --------------------------------------------------------------------------------- */
export function MySignatures() {
  const [list, setList] = useState<MySignature[] | null>(null), [error, setError] = useState('');
  useEffect(() => { signatures.mine().then(setList, (e) => setError(errorText(e))); }, []);
  const pending = list?.filter((r) => r.status === 'pending' && r.myStatus === 'pending') ?? [];
  return <>
    <PageHead title="Minhas assinaturas" description="Documentos enviados para você assinar eletronicamente. Abra, confira e assine sem baixar nada." />
    {error ? <Notice tone="crit">{error}</Notice> : !list ? <Skeleton /> : !list.length ? <div className="panel"><Empty title="Nada para assinar">Quando a coordenação enviar um documento para sua assinatura, ele aparece aqui.</Empty></div> : <div className="stack">
      {pending.length > 0 && <Notice tone="warn" title={pending.length === 1 ? '1 documento aguarda sua assinatura' : `${pending.length} documentos aguardam sua assinatura`} />}
      <div className="panel"><div className="table-wrap"><table className="ledger">
        <thead><tr><th>Documento</th><th>Sua assinatura</th><th>Situação</th><th>Enviado</th><th aria-label="Ações" /></tr></thead>
        <tbody>{list.map((r) => { const [text, tone] = signerText[r.myStatus]; return <tr key={r.id}>
          <td><b>{r.label}</b><small>{r.projectTitle}</small></td>
          <td><Tag tone={r.status === 'pending' && r.myStatus === 'waiting' ? 'mute' : tone}>{r.myStatus === 'waiting' ? 'Aguardando a vez' : text}</Tag></td>
          <td><Tag tone={requestTone[r.status]}>{requestText[r.status]}</Tag></td>
          <td className="num">{fmt(r.createdAt)}</td>
          <td><NavLink className={r.myStatus === 'pending' && r.status === 'pending' ? 'btn btn-primary btn-sm' : 'btn btn-sm'} to={`/assinar/${r.id}`}>{r.myStatus === 'pending' && r.status === 'pending' ? 'Assinar' : 'Abrir'}</NavLink></td>
        </tr>; })}</tbody>
      </table></div></div>
    </div>}
  </>;
}

/** Form 26 as the signer reads it. */
function Form26Preview({ view }: { view: SigningView & { document: { kind: 'travel' } } }) {
  const { beneficiary: b, report: r } = view.document, s = view.request.signers;
  const rows = r.entries.filter((e) => e.date || e.activity.trim());
  const stamp = (step: number) => { const x = s.find((y) => y.step === step && y.status === 'signed'); return x ? <Seal s={x} /> : <span className="paper-line" />; };
  return <article className="paper paper-sans" aria-label="Documento a assinar">
    <header className="paper-head"><img src="/fapto-logo.png" alt="FAPTO" /><b>FUNDAÇÃO DE APOIO CIENTÍFICO E TECNOLÓGICO DO TOCANTINS</b><b>FORMULÁRIO 26<br />RELATÓRIO DE VIAGEM</b></header>
    <h4>IDENTIFICAÇÃO DO BENEFICIÁRIO</h4>
    <p>Nome do beneficiário: {b.name}</p>
    <p>Contato telefônico: {formatPhone(b.phone)} <span style={{ marginLeft: 24 }}>E-mail: {b.email}</span></p>
    <p><b>Projeto/convênio:</b> {b.project}</p>
    <p>Função no projeto/convênio: {b.role}</p>
    <h4>IDENTIFICAÇÃO DO AFASTAMENTO</h4>
    <p>Cidade/UF origem: {r.origin || 'Palmas/TO'}<br />Cidade/UF destino: {r.destination || 'Lagoa da Confusão/TO'}</p>
    <p>Saída: {br(r.departureDate)} <span style={{ marginLeft: 24 }}>Retorno: {br(r.returnDate)}</span></p>
    <p>Data do pagamento da diária: {br(r.paymentDate)}</p>
    <table className="paper-table">
      <thead><tr><th colSpan={2}>DESCRIÇÃO DA VIAGEM<small>Descrever o objetivo da viagem e relatar os resultados, assim como outras informações pertinentes</small></th></tr></thead>
      <tbody>
        {r.objective.trim() && <tr><td colSpan={2}><b>Objetivo:</b> {r.objective}</td></tr>}
        <tr><td style={{ width: '22%' }}>Data</td><td>Atividades</td></tr>
        {(rows.length ? rows : [{ date: r.departureDate ?? '', activity: '' }]).map((e, i) => <tr key={i}><td>{e.date ? br(e.date) : ''}</td><td style={{ whiteSpace: 'pre-wrap' }}>{e.activity}</td></tr>)}
        <tr className="paper-sign"><td>Data:</td><td>Assinatura do beneficiário: {stamp(1)}</td></tr>
        <tr className="paper-sign"><td>Data:</td><td>De acordo (Coordenador do projeto): {stamp(2)}</td></tr>
      </tbody>
    </table>
    <h4 className="paper-center">REGISTRO FOTOGRÁFICO</h4>
    {r.photos?.length ? <div className="paper-photos">{r.photos.map((p) => <figure key={p.key}>{p.url && <img src={p.url} alt={p.caption || p.name} />}{p.caption && <figcaption>{p.caption}</figcaption>}</figure>)}</div> : <p className="muted">Nenhuma foto inserida ainda.</p>}
  </article>;
}
function RtpPreview({ content }: { content: ReportContent }) {
  const block = (title: string, text: string) => <><h4>{title}</h4>{text.split(/\n+/).filter((l) => l.trim()).map((l, i) => <p key={i} className="paper-justify">{l}</p>)}</>;
  return <article className="paper paper-serif" aria-label="Documento a assinar">
    <header className="paper-head"><img src="/fapto-logo.png" alt="FAPTO" /><b>{content.heading.foundation.toLocaleUpperCase('pt-BR')}</b><b>{content.heading.form}</b></header>
    <table className="paper-table paper-id"><tbody>
      <tr><th colSpan={2}>RELATÓRIO TÉCNICO PARCIAL (RTP)</th></tr>
      <tr><td>Título do Projeto</td><td>{content.heading.project}</td></tr><tr><td>Bolsista:</td><td>{content.heading.scholar}</td></tr>
      <tr><td>Vigência da Bolsa:</td><td><b>{content.heading.scholarshipPeriod}</b></td></tr><tr><td>RTP Nº:</td><td>{content.heading.number}</td></tr>
    </tbody></table>
    <h4>1. Resultados Parciais</h4>
    {block('1.1 Objetivos propostos no plano individual versus objetivos alcançados', content.sections.results)}
    {block('1.2 Resultados esperados versus resultados obtidos (conforme cronograma estabelecido)', content.sections.comparison)}
    {block('2. Informações Adicionais', content.sections.additional)}
    <p style={{ textAlign: 'right', marginTop: 24 }}>{content.closing.placeAndDate}</p>
    <p className="paper-center" style={{ marginTop: 32 }}>{content.closing.scholar}<br />{content.closing.role}</p>
  </article>;
}

export function SignPage() {
  const { id } = useParams(), toast = useToast(), navigate = useNavigate();
  const [view, setView] = useState<SigningView | null>(null), [error, setError] = useState('');
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState<TravelReport | ReportContent['sections'] | null>(null), [saving, setSaving] = useState(false);
  const [cpf, setCpf] = useState(''), [accept, setAccept] = useState(false), [signing, setSigning] = useState(false), [result, setResult] = useState<{ completed: boolean; code: string | null } | null>(null);
  const load = useCallback(() => signatures.get(id!).then((v) => { setView(v); setError(''); }, (e) => setError(errorText(e))), [id]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <div className="stack"><Notice tone="crit" title="Não foi possível abrir o documento">{error}</Notice><div><NavLink className="btn" to="/assinaturas">Minhas assinaturas</NavLink></div></div>;
  if (!view) return <Skeleton />;
  const r = view.request, doc = view.document, me = view.me, parallel = (view.mode ?? r.mode) === 'parallel';
  const dirty = editing && draft !== null && JSON.stringify(draft) !== JSON.stringify(doc.kind === 'travel' ? doc.report : doc.kind === 'rtp' ? doc.content.sections : null);
  function startEdit() { if (doc.kind === 'minutes') return; setDraft(doc.kind === 'travel' ? { ...doc.report } : { ...doc.content.sections }); setEditing(true); }
  async function save() {
    setSaving(true);
    try {
      if (doc.kind === 'travel') { const t = draft as TravelReport; await signatures.saveDocument(r.id, { origin: t.origin, destination: t.destination, departureDate: t.departureDate || null, returnDate: t.returnDate || null, paymentDate: t.paymentDate || null, objective: t.objective, entries: t.entries }); }
      else await signatures.saveDocument(r.id, { sections: draft });
      toast('Alterações salvas no documento.'); setEditing(false); setDraft(null); await load();
    } catch (e) { toast(errorText(e), 'crit'); } finally { setSaving(false); }
  }
  async function sign(e: FormEvent) {
    e.preventDefault(); setSigning(true);
    try { const res = await signatures.sign(r.id, cpf); setResult({ completed: res.completed, code: res.verificationCode }); setCpf(''); setAccept(false); await load(); }
    catch (x) { toast(errorText(x), 'crit'); } finally { setSigning(false); }
  }
  async function reject() {
    const reason = prompt('Por que você não vai assinar? A coordenação verá esta resposta.');
    if (reason === null) return;
    try { await signatures.reject(r.id, reason); toast('Recusa registrada.'); await load(); } catch (x) { toast(errorText(x), 'crit'); }
  }
  const waitingTurn = r.status === 'pending' && me?.status === 'waiting';

  return <>
    <NavLink to={view.manager ? (doc.kind === 'travel' ? `/travel/${r.sourceId}` : doc.kind === 'minutes' ? `/atas/${doc.minuteId}` : `/reports/${r.sourceId}`) : '/assinaturas'} className="back"><ArrowLeft />{view.manager ? 'Voltar ao documento' : 'Minhas assinaturas'}</NavLink>
    <div className="head">
      <div><h1>{doc.kind === 'travel' ? 'Relatório de viagem' : doc.kind === 'minutes' ? doc.number : `RTP ${doc.number}`}</h1><p>{r.label}. {view.projectTitle}</p></div>
      <div className="head-actions"><Tag tone={requestTone[r.status]}>{requestText[r.status]}</Tag></div>
    </div>
    {result && <div style={{ marginBottom: 16 }}><Notice tone="ok" title="Assinatura registrada">{result.completed ? (doc.kind === 'minutes' ? <>Todas as assinaturas foram concluídas. A ata assinada pode ser conferida pelo código <b>{doc.publicCode}</b>.</> : <>Todas as assinaturas foram concluídas. Código de verificação: <b>{result.code}</b>.</>) : parallel ? 'Sua assinatura foi incluída na ata. Os demais participantes continuam podendo assinar.' : 'O documento segue agora para a próxima pessoa da ordem de assinatura.'}</Notice></div>}
    {view.canSign && !result && <div className="sign-banner" role="status"><PenLine /><div><b>Sua assinatura está pendente</b><span>Leia o documento e assine com o seu CPF. {parallel ? 'Os participantes assinam em qualquer ordem.' : 'É a sua vez na ordem de assinatura.'}</span></div><a className="btn btn-go" href="#assinar" onClick={(e) => { e.preventDefault(); document.getElementById('assinar')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); (document.querySelector('#assinar input') as HTMLInputElement | null)?.focus({ preventScroll: true }); }}>Assinar agora</a></div>}
    {!me && view.manager && r.status === 'pending' && <div style={{ marginBottom: 16 }}><Notice tone="info" title="Você está acompanhando este documento">Sua assinatura não foi solicitada nele. Os signatários estão listados ao lado.</Notice></div>}
    {r.status === 'rejected' && <div style={{ marginBottom: 16 }}><Notice tone="crit" title="Assinatura recusada">{r.closedReason}</Notice></div>}
    {r.status === 'cancelled' && <div style={{ marginBottom: 16 }}><Notice tone="mute" title="Solicitação cancelada pela coordenação">{r.closedReason}</Notice></div>}

    <div className="split">
      <div className="stack">
        {editing && draft ? <>
          {doc.kind === 'travel' ? <>
            <TravelFields r={draft as TravelReport} set={(p) => setDraft({ ...(draft as TravelReport), ...p })} locked={saving} />
            <PhotoManager endpoint={`/signatures/${r.id}/photos`} photos={doc.report.photos ?? []} locked={saving} onChange={(photos) => setView({ ...view, document: { ...doc, report: { ...doc.report, photos } } })} />
          </> : <section className="panel panel-pad stack">
            {([['results', '1.1 Objetivos propostos versus alcançados'], ['comparison', '1.2 Resultados esperados versus obtidos'], ['additional', '2. Informações adicionais']] as const).map(([k, label]) =>
              <label className="field" key={k}>{label}<textarea value={(draft as ReportContent['sections'])[k]} onChange={(e) => setDraft({ ...(draft as ReportContent['sections']), [k]: e.target.value })} style={{ minHeight: 200 }} /></label>)}
          </section>}
          <div className="head-actions"><button className="btn btn-quiet" disabled={saving} onClick={() => { setEditing(false); setDraft(null); }}>Descartar</button><button className="btn btn-primary" disabled={saving || (!dirty && doc.kind !== 'travel')} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar alterações'}</button></div>
        </> : doc.kind === 'travel' ? <Form26Preview view={view as SigningView & { document: { kind: 'travel' } }} /> : doc.kind === 'minutes'
          ? <iframe className="paper-frame" title={`${doc.number} em PDF`} src={`${signatures.fileUrl(r.id, 'pdf')}#view=FitH`} />
          : <RtpPreview content={doc.content} />}
      </div>

      <aside className="side">
        {view.canSign && <form id="assinar" className="panel stack sign-card" style={{ gap: 12 }} onSubmit={sign}>
          <h3 style={{ marginBottom: 0 }}><PenLine size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />Assinar eletronicamente</h3>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>Assinando como <b>{me!.name}</b>{me!.roleLabel ? `, ${me!.roleLabel}` : ''}.</p>
          <label className="field">CPF<input inputMode="numeric" autoComplete="off" value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} placeholder="000.000.000-00" required disabled={signing || dirty} />{me!.cpfOnFile && <small>Use o mesmo CPF das assinaturas anteriores ({me!.cpfOnFile}).</small>}</label>
          <label className="check"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} disabled={signing || dirty} /><span>Li o documento e declaro que as informações são verdadeiras. Concordo em assiná-lo eletronicamente, ficando registrados meu nome, CPF, data, hora e endereço IP.</span></label>
          <button className="btn btn-go btn-block" disabled={signing || dirty || !accept || cpf.replace(/\D/g, '').length !== 11}>{signing ? 'Assinando…' : 'Assinar documento'}</button>
          {view.canEdit && !editing && <button type="button" className="btn btn-block" onClick={startEdit}><PenLine />Alterar ou inserir informações</button>}
          {dirty && <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Salve as alterações antes de assinar.</p>}
          <button type="button" className="btn btn-quiet btn-block" onClick={() => void reject()}><X />Não vou assinar</button>
          <p className="muted hash" style={{ fontSize: 11.5, margin: 0, overflowWrap: 'anywhere' }}>Hash SHA-256 do conteúdo: {view.documentHash}</p>
          <LegalBasis compact />
        </form>}
        <div className="panel">
          <h3>{parallel ? 'Assinaturas (em qualquer ordem)' : 'Ordem de assinatura'}</h3>
          <Steps signers={r.signers} parallel={parallel} />
        </div>
        {!view.canSign && view.canEdit && !editing && <button className="btn btn-block" onClick={startEdit}><PenLine />Alterar ou inserir informações</button>}
        {waitingTurn && <Notice tone="info" title="Aguardando a sua vez">Você será a próxima pessoa a assinar assim que a anterior concluir.</Notice>}
        {me?.status === 'signed' && <Notice tone="ok" title="Você já assinou">Assinatura registrada em {when(me.signedAt)}{me.cpf ? `, CPF ${me.cpf}` : ''}.</Notice>}
        <div className="panel">
          <h3>Documento</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            <a className="btn btn-block" href={signatures.fileUrl(r.id, 'pdf')} target="_blank" rel="noreferrer"><ExternalLink />Ver em PDF</a>
            {doc.kind !== 'minutes' && <a className="btn btn-block" href={signatures.fileUrl(r.id, 'docx')}><Download />Baixar DOCX</a>}
            {doc.kind === 'minutes' && <a className="btn btn-block" href={`/verificar-documento/${doc.publicCode}`} target="_blank" rel="noreferrer"><ShieldCheck />Verificação de autenticidade</a>}
            {doc.kind !== 'minutes' && r.status === 'completed' && r.verificationCode && <button className="btn btn-block" onClick={() => navigate(`/verificar/${r.verificationCode}`)}><ShieldCheck />Comprovante de verificação</button>}
          </div>
        </div>
      </aside>
    </div>
  </>;
}

/* Public verification -------------------------------------------------------------------------- */
export function VerifyPage() {
  const { code } = useParams(), navigate = useNavigate();
  const [input, setInput] = useState(code ?? ''), [result, setResult] = useState<VerifyResult | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!code) return;
    setBusy(true); setError('');
    signatures.verify(code).then(setResult, (e) => { setResult(null); setError(errorText(e)); }).finally(() => setBusy(false));
  }, [code]);
  return <main className="verify">
    <div className="verify-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Pivot sectors={['on', 'on', 'on', 'warn', 'off']} size={30} /><b style={{ fontFamily: 'var(--display)', fontStretch: '80%', fontSize: 18 }}>Verificação de assinaturas</b></div>
      <form className="toolbar" style={{ padding: 0 }} onSubmit={(e) => { e.preventDefault(); navigate(`/verificar/${input.trim()}`); }}>
        <input className="grow" value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" aria-label="Código de verificação" />
        <button className="btn btn-primary" disabled={busy || input.replace(/[^0-9A-F]/gi, '').length !== 12}>Verificar</button>
      </form>
      {busy ? <Skeleton /> : error ? <Notice tone="crit">{error}</Notice> : result && <div className="stack" style={{ gap: 12 }}>
        <Notice tone={result.valid ? 'ok' : 'warn'} title={result.valid ? 'Documento com assinaturas válidas' : 'Assinaturas sem validade'}>{result.valid ? `Concluído em ${when(result.completedAt)}.` : 'As assinaturas deste documento foram canceladas.'}</Notice>
        <dl className="facts"><div><dt>Documento</dt><dd>{result.label}</dd></div><div><dt>Projeto</dt><dd>{result.project}</dd></div><div><dt>Código</dt><dd>{result.code}</dd></div><div><dt>Hash do documento</dt><dd className="hash" style={{ overflowWrap: 'anywhere' }}>{result.documentHash}</dd></div></dl>
        <ol className="sign-steps">{result.signers.map((s) => <li key={s.step} data-status="signed"><span className="sign-step-n"><Check /></span><div><b>{s.name}</b><small>{s.roleLabel}</small><small>CPF {s.cpf}, em {when(s.signedAt)}</small><small className="hash" style={{ overflowWrap: 'anywhere' }}>{s.signatureHash}</small></div></li>)}</ol>
        <LegalBasis />
      </div>}
    </div>
  </main>;
}

/* Signature-only accounts: nothing but their documents -------------------------------------------- */
export function SignerShell({ user, logout }: { user: User; logout: () => void }) {
  // Modules enabled by the administration (e.g. Atas de Reunião) open beside the signatures.
  const grants = user.modules ?? [];
  const projects = [...new Map(grants.map((g) => [g.projectId, { id: g.projectId, title: g.projectTitle } as Project])).values()];
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const project = projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
  const has = (m: string) => !!project && grants.some((g) => g.projectId === project.id && (g.module === m || (g.module === 'minutes_sender' && (m === 'minutes' || m === 'whatsapp'))));
  const scope = { user, logout, projects, project, setProjectId, reloadProjects: async () => undefined, canManage: false };
  return <div className="signer-shell">
    <header className="signer-bar">
      <NavLink to="/assinaturas" className="signer-brand"><Pivot sectors={['on', 'on', 'on', 'warn', 'off']} size={28} /><span>RTP Inteligente<small>{has('minutes') ? 'Assinaturas e atas' : 'Assinatura de documentos'}</small></span></NavLink>
      {(has('minutes') || has('whatsapp')) && <nav className="signer-nav"><NavLink to="/assinaturas">Minhas assinaturas</NavLink>{has('minutes') && <NavLink to="/atas">Atas de Reunião</NavLink>}{has('whatsapp') && <NavLink to="/connectivity">Conectividade</NavLink>}</nav>}
      {projects.length > 1 && <select className="signer-project" value={project?.id ?? ''} onChange={(e) => setProjectId(e.target.value)} aria-label="Projeto">{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>}
      <NotificationBell />
      <span className="signer-user">{user.name}</span>
      <button className="btn btn-sm" onClick={logout}><LogOut />Sair</button>
    </header>
    <main className="page">
      <ScopeContext.Provider value={scope as never}>
        <Routes>
          <Route path="/assinaturas" element={<MySignatures />} />
          <Route path="/assinar/:id" element={<SignPage />} />
          {has('minutes') && <Route path="/atas" element={<MinutesList />} />}
          {has('minutes') && <Route path="/atas/:id" element={<MinuteEditor />} />}
          {has('whatsapp') && <Route path="/connectivity" element={<Connectivity />} />}
          <Route path="*" element={<Navigate to="/assinaturas" replace />} />
        </Routes>
      </ScopeContext.Provider>
    </main>
  </div>;
}
