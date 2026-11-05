import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { FileSignature, ShieldCheck } from 'lucide-react';
import { route } from '../api';
import { Notice, Skeleton, errorText } from '../ui';

type View = { name: string; label: string; phone: string; verified: boolean; signed: boolean; expiresAt: string };
export default function ExternalSignature() {
  const { token } = useParams(), endpoint = `/external-signatures/${token}`;
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [cpf, setCpf] = useState(''), [code, setCode] = useState(''), [sent, setSent] = useState(false), [accept, setAccept] = useState(false), [retryAt, setRetryAt] = useState(0), [now, setNow] = useState(Date.now());
  const load = useCallback(() => route<View>(endpoint).then(setView), [endpoint]);
  useEffect(() => { void load().catch(e => setError(errorText(e))); }, [load]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  async function act(action: 'challenge' | 'verify' | 'sign', event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setError('');
    try {
      await route(endpoint, { method: 'POST', body: JSON.stringify({ action, cpf, code, accept }) });
      if (action === 'challenge') { setSent(true); setRetryAt(Date.now() + 60000); }
      if (action === 'verify' || action === 'sign') await load();
      if (action === 'verify') { setCpf(''); setCode(''); }
      if (action === 'sign') { setCpf(''); setCode(''); setAccept(false); }
    } catch (e) {
      setError(errorText(e));
      if (action === 'sign') { setSent(false); await load().catch(() => {}); }
    } finally { setBusy(false); }
  }
  const retry = Math.max(0, Math.ceil((retryAt - now) / 1000));
  return <main className="external-sign-page">
    <header className="external-sign-brand"><FileSignature /><b>RTP Inteligente</b><span>Assinatura de convidado</span></header>
    <div className="external-sign-content stack">
      <h1>Assinar ata de reunião</h1>
      {error && <Notice tone="crit">{error}</Notice>}
      {!view ? (!error && <Skeleton />) : <>
        <p className="lead">{view.name}, este link individual é para sua assinatura em {view.label}.</p>
        <ol className="steps"><li data-state={view.verified ? 'done' : 'current'}>Confirmar identidade</li><li data-state={view.signed ? 'done' : view.verified ? 'current' : undefined}>Ler e assinar</li></ol>
        {view.signed ? <Notice tone="ok" title="Assinatura registrada"><ShieldCheck /> Sua assinatura foi incluída na ata. A coordenação acompanhará as demais assinaturas e o PDF final.</Notice> : !view.verified ? <form className="panel panel-pad stack" onSubmit={e => void act(sent ? 'verify' : 'challenge', e)}>
          <h2>Confirme que é você</h2><p>Informe o CPF cadastrado pela organização. O código será enviado somente ao WhatsApp com final {view.phone}.</p>
          <label className="field">Seu CPF<input value={cpf} required maxLength={20} inputMode="numeric" autoComplete="off" disabled={busy} onChange={e => { setCpf(e.target.value); setCode(''); }} /></label>
          {sent && <label className="field">Código recebido no WhatsApp<input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" disabled={busy} /><small>Válido por 5 minutos; até 5 tentativas.</small></label>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Aguarde…' : sent ? 'Confirmar código e abrir ata' : 'Receber código pelo WhatsApp'}</button>
          {sent && <button type="button" className="btn" disabled={busy || retry > 0} onClick={() => void act('challenge')}>{retry ? `Reenviar código em ${retry}s` : 'Reenviar código'}</button>}
        </form> : <>
          <Notice tone="ok" title="Identidade confirmada">Leia a ata completa antes de assinar. A confirmação vale por 10 minutos.</Notice>
          <a className="btn" target="_blank" rel="noreferrer" href={`/api${endpoint}?file=1`}>Abrir PDF em outra aba</a>
          <iframe className="external-sign-document" title="Ata para leitura e assinatura" src={`/api${endpoint}?file=1`} />
          <form className="panel panel-pad stack" onSubmit={e => void act('sign', e)}>
            <label className="field">Confirme seu CPF<input required value={cpf} inputMode="numeric" maxLength={20} onChange={e => { setCpf(e.target.value); setAccept(false); }} /></label>
            <label className="check"><input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} /><span>Li a ata, confirmo minha identidade e concordo em assinar eletronicamente. Serão registrados meu nome, CPF, data, hora, IP e a integridade do documento.</span></label>
            <button className="btn btn-go" disabled={busy || !accept}>{busy ? 'Registrando…' : 'Assinar ata'}</button>
          </form>
        </>}
      </>}
      <p className="muted">Se os dados não são seus, não prossiga. Peça a correção à coordenação. Não compartilhe este link nem o código recebido.</p>
    </div>
  </main>;
}
