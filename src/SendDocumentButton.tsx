import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Send } from 'lucide-react';
import { route, scholars } from './api';
import type { ConnectivityStatus, DeliverySource } from './connectivity';
import type { ScholarOverview } from './types';
import { Drawer, Notice, Skeleton, errorText, useScope, useToast } from './ui';

export default function SendDocumentButton({ source, disabled, iconOnly = false, className = '', onSent }: { source: DeliverySource; disabled?: boolean; iconOnly?: boolean; className?: string; onSent?: () => void }) {
  const { project, user } = useScope();
  const [open, setOpen] = useState(false), [attempt, setAttempt] = useState(0);
  return <>
    <button type="button" className={`${iconOnly ? 'icon-btn' : 'btn'} ${className}`} disabled={disabled} onClick={() => { setAttempt(n => n + 1); setOpen(true); }} aria-label={`Enviar documento: ${source.label}`} title={`Enviar documento: ${source.label}`}><Send />{!iconOnly && 'Enviar documento'}</button>
    {open && <SendDialog key={`${user.id}:${project!.id}:${source.kind}:${source.id}:${attempt}`} source={source} projectId={project!.id} onClose={() => setOpen(false)} onSent={onSent} />}
  </>;
}
function SendDialog({ source, projectId, onClose, onSent }: { source: DeliverySource; projectId: string; onClose: () => void; onSent?: () => void }) {
  const toast = useToast();
  const [members, setMembers] = useState<ScholarOverview[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [connection, setConnection] = useState<ConnectivityStatus | null>(null), [connectionError, setConnectionError] = useState('');
  const [recipient, setRecipient] = useState(''), [phone, setPhone] = useState(''), [format, setFormat] = useState<'pdf' | 'docx' | 'original'>(source.kind === 'document' ? 'original' : 'docx');
  const [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [requestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let active = true;
    void scholars.list(projectId).then(rows => {
      if (!active) return;
      setMembers(rows);
      const selected = rows.find(row => row.id === (source.scholarId || (source.kind === 'travel' ? source.id : '')));
      if (selected) { setRecipient(selected.id); setPhone(selected.phone || ''); }
    }).catch(e => { if (active) setError(errorText(e)); }).finally(() => { if (active) setLoading(false); });
    void route<ConnectivityStatus>(`/connectivity?projectId=${projectId}`).then(data => { if (active) setConnection(data); }).catch(e => { if (active) setConnectionError(errorText(e)); });
    return () => { active = false; };
  }, [projectId, source.kind, source.id, source.scholarId]);
  async function send() {
    setBusy(true); setError('');
    try {
      await route('/documents/send', { method: 'POST', body: JSON.stringify({ projectId, kind: source.kind, sourceId: source.id, format, recipientPhone: phone, requestId }) });
      toast('Documento aceito pelo servidor WhatsApp para envio.'); onSent?.(); onClose();
    } catch (e) { setError(errorText(e)); setChecked(false); }
    finally { setBusy(false); }
  }
  return <Drawer open onClose={() => { if (!busy) onClose(); }} title="Enviar documento" description={source.label}>
    <div className="stack">
      {loading ? <Skeleton /> : <>
        {connectionError && <Notice tone="warn" title="Não foi possível consultar o WhatsApp">{connectionError}<p><NavLink to="/connectivity" onClick={onClose}>Abrir Conectividade</NavLink></p></Notice>}
        {connection && !connection.configured && <Notice tone="warn" title="Conecte seu WhatsApp">{connection.stateError || 'Sua conexão está aguardando pareamento.'}<p><NavLink to="/connectivity" onClick={onClose}>Abrir Conectividade e conectar meu aparelho</NavLink></p></Notice>}
        <label className="field">Destinatário<select value={recipient} disabled={busy} onChange={event => { setRecipient(event.target.value); setPhone(members.find(row => row.id === event.target.value)?.phone || ''); setChecked(false); }}><option value="">Informar outro número</option>{members.map(row => <option key={row.id} value={row.id}>{row.full_name}{row.phone ? '' : ' — telefone não cadastrado'}</option>)}</select></label>
        <label className="field">Telefone do destinatário (DDI + DDD)<input type="tel" autoComplete="off" inputMode="tel" required placeholder="5563999999999" value={phone} maxLength={35} disabled={busy} onChange={event => { setPhone(event.target.value); setChecked(false); }} /><small>Você pode usar o telefone cadastrado ou informar o contato que receberá este documento.</small></label>
        <label className="field">Formato<select value={format} disabled={busy || source.kind === 'document'} onChange={event => { setFormat(event.target.value as typeof format); setChecked(false); }}>{source.kind === 'document' ? <option value="original">Arquivo original</option> : <><option value="docx">DOCX editável</option><option value="pdf">PDF</option></>}</select></label>
        <Notice title="Confira antes de enviar">{source.label}<br />Destino: <b>{phone || 'Informe o número acima'}</b>{source.kind === 'rtp' && <p>Será enviada a versão salva do RTP. Relatórios ainda não aprovados são enviados como prévia.</p>}</Notice>
        <label className="delivery-confirm"><input type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} /><span>Conferi o documento e o número do destinatário.</span></label>
        {error && <Notice tone="crit">{error}</Notice>}
        <button className="btn btn-primary" disabled={busy || !checked || !phone.trim() || !connection?.configured} onClick={() => void send()}><Send />{busy ? 'Enviando documento…' : 'Enviar pelo WhatsApp'}</button>
        <small className="muted">A solicitação ficará no seu histórico em Conectividade. Em caso de resposta incerta, confira o WhatsApp antes de fechar e abrir uma nova tentativa.</small>
      </>}
    </div>
  </Drawer>;
}
