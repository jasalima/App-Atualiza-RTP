import { useEffect, useState } from 'react';
import { Paperclip, Send } from 'lucide-react';
import { faptoEmail, type FaptoEmailPreview, type FaptoEmailSettings } from './api';
import { Drawer, Notice, Skeleton, errorText, fmt, useToast } from './ui';

const list = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const NOT_READY = 'O envio de e-mail ainda não está ativo no servidor: cadastre RESEND_API_KEY e EMAIL_FROM (remetente de um domínio verificado no Resend) nas variáveis da Vercel.';

/** Recipients and message model of the e-mail to the FAPTO analyst (coordination). */
export function FaptoTemplateDrawer({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<FaptoEmailSettings | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [to, setTo] = useState(''), [cc, setCc] = useState(''), [subject, setSubject] = useState(''), [body, setBody] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true; setError('');
    faptoEmail.settings(projectId).then((s) => { if (!active) return; setData(s); setTo(s.recipients.join(', ')); setCc(s.cc.join(', ')); setSubject(s.subject); setBody(s.body); })
      .catch((e) => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [open, projectId]);
  async function save() {
    setBusy(true);
    try { const s = await faptoEmail.save(projectId, { recipients: list(to), cc: list(cc), subject, body }); setData(s); toast('Modelo de e-mail salvo.'); onClose(); }
    catch (e) { toast(errorText(e), 'crit'); } finally { setBusy(false); }
  }
  return <Drawer open={open} onClose={onClose} title="E-mail à FAPTO" description="Para quem vão os relatórios assinados e o texto da mensagem. Os campos entre chaves são preenchidos no envio.">
    {error ? <Notice tone="crit">{error}</Notice> : !data ? <Skeleton /> : <div className="grid-form">
      {!data.provider.ready && <div className="span-2"><Notice tone="warn">{NOT_READY}</Notice></div>}
      {data.provider.ready && <p className="muted span-2">Remetente: <b>{data.provider.from}</b>. As respostas da FAPTO chegam no seu e-mail.</p>}
      <label className="field span-2">E-mail da colaboradora da FAPTO<input value={to} onChange={(e) => setTo(e.target.value)} placeholder="analista@fapto.org.br" inputMode="email" /></label>
      <label className="field span-2">Com cópia para (opcional)<input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Separe vários e-mails por vírgula" inputMode="email" /></label>
      <label className="field span-2">Assunto<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label className="field span-2">Mensagem<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} /></label>
      <dl className="facts span-2">{Object.entries(data.placeholders).map(([k, v]) => <div key={k}><dt><code>{`{{${k}}}`}</code></dt><dd>{v}</dd></div>)}</dl>
      <div className="form-foot span-2"><button className="btn btn-quiet" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy || !list(to).length} onClick={() => void save()}>{busy ? 'Salvando…' : 'Salvar modelo'}</button></div>
    </div>}
  </Drawer>;
}

/** Preview of the message with the signed PDFs attached; one click sends it. */
export function FaptoSendDrawer({ projectId, reportIds, onClose, onSent, onConfigure }: { projectId: string; reportIds: string[]; onClose: () => void; onSent: () => void; onConfigure: () => void }) {
  const toast = useToast(), open = reportIds.length > 0;
  const [data, setData] = useState<FaptoEmailPreview | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState(''), [body, setBody] = useState('');
  const key = reportIds.join(',');
  useEffect(() => {
    if (!key) return;
    let active = true; setData(null); setError('');
    faptoEmail.preview(projectId, key.split(',')).then((p) => { if (active) { setData(p); setSubject(p.subject); setBody(p.body); } }).catch((e) => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [key, projectId]);
  async function send() {
    if (data?.lastSentAt && !confirm(`Este relatório já foi enviado à FAPTO em ${fmt(data.lastSentAt)}. Enviar novamente?`)) return;
    setBusy(true);
    try { const r = await faptoEmail.send(projectId, reportIds, subject, body); toast(`E-mail enviado para ${r.to.join(', ')}.`); onSent(); onClose(); }
    catch (e) { toast(errorText(e), 'crit'); } finally { setBusy(false); }
  }
  return <Drawer open={open} onClose={onClose} title="Enviar à FAPTO" description="Confira a mensagem. Os relatórios assinados vão em anexo, em PDF.">
    {error ? <Notice tone="crit">{error}</Notice> : !data ? <Skeleton /> : <div className="grid-form">
      {!data.ready && <div className="span-2"><Notice tone="warn">{NOT_READY}</Notice></div>}
      {!data.to.length && <div className="span-2"><Notice tone="warn" title="Falta o destinatário">Informe o e-mail da colaboradora da FAPTO no modelo de e-mail. <button className="btn btn-quiet" onClick={onConfigure}>Configurar</button></Notice></div>}
      {data.lastSentAt && <div className="span-2"><Notice>Já enviado à FAPTO em {fmt(data.lastSentAt)}.</Notice></div>}
      <dl className="facts span-2">
        <div><dt>Para</dt><dd>{data.to.join(', ') || '—'}</dd></div>
        {data.cc.length > 0 && <div><dt>Cópia</dt><dd>{data.cc.join(', ')}</dd></div>}
        <div><dt>Anexos</dt><dd>{data.files.map((f) => <div key={f}><Paperclip size={13} /> {f}</div>)}</dd></div>
      </dl>
      <label className="field span-2">Assunto<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label className="field span-2">Mensagem<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} /></label>
      <div className="form-foot span-2">
        <button className="btn btn-quiet" onClick={onConfigure}>Editar modelo</button>
        <button className="btn btn-primary" disabled={busy || !data.ready || !data.to.length} onClick={() => void send()}><Send />{busy ? 'Enviando…' : 'Enviar e-mail'}</button>
      </div>
    </div>}
  </Drawer>;
}
