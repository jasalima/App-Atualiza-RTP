import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link2, QrCode, RefreshCw, Settings, Users } from 'lucide-react';
import { route } from '../api';
import type { ConnectivityStatus, DeliveryHistory } from '../connectivity';
import { Empty, Notice, PageHead, Skeleton, Tag, errorText, useAsync, useScope, useToast } from '../ui';

export default function Connectivity() {
  const { project, user, canManage } = useScope();
  return <ConnectivityProject key={`${user.id}:${project!.id}`} projectId={project!.id} canManage={canManage} />;
}
function ConnectivityProject({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const toast = useToast();
  const status = useAsync(() => route<ConnectivityStatus>(`/connectivity?projectId=${projectId}`), [projectId]);
  const history = useAsync(() => route<DeliveryHistory[]>(`/documents/history?projectId=${projectId}`), [projectId]);
  const [busy, setBusy] = useState(''), [qr, setQr] = useState<string | null>(null), [expired, setExpired] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false), [serverUrl, setServerUrl] = useState(''), [apiKey, setApiKey] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (status.data?.serverUrl) setServerUrl(status.data.serverUrl); }, [status.data?.serverUrl]);
  useEffect(() => {
    if (!qr) return;
    let active = true, pending = false;
    const timer = setTimeout(() => { if (active) { setQr(null); setExpired(true); } }, 60000);
    const poll = setInterval(async () => {
      if (pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const result = await route<ConnectivityStatus>(`/connectivity?projectId=${projectId}`);
        if (active) { status.set(result); if (result.configured) { setQr(null); setExpired(false); toast('Seu WhatsApp está conectado.'); } }
      } catch { /* The QR remains visible; explicit refresh is always available. */ }
      finally { pending = false; }
    }, 8000);
    return () => { active = false; clearTimeout(timer); clearInterval(poll); };
  }, [qr, projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function connect() {
    setBusy('connect'); setQr(null); setExpired(false);
    try {
      await route('/connectivity', { method: 'POST', body: JSON.stringify({ projectId, action: 'provision' }) });
      const result = await route<{ connected: boolean; qr: string | null }>('/connectivity', { method: 'POST', body: JSON.stringify({ projectId, action: 'connect' }) });
      if (!alive.current) return;
      setQr(result.qr);
      await status.reload();
      if (result.connected) toast('Seu WhatsApp já está conectado.');
      else if (!result.qr) toast('O servidor ainda está preparando o QR Code. Aguarde e tente novamente.');
    } catch (error) { if (alive.current) toast(errorText(error), 'crit'); }
    finally { if (alive.current) setBusy(''); }
  }
  async function prepareProject() {
    setBusy('project');
    try {
      const result = await route<{ prepared: number; total: number; failed: number }>('/connectivity', { method: 'POST', body: JSON.stringify({ projectId, action: 'provisionProject' }) });
      if (!alive.current) return;
      toast(`${result.prepared} de ${result.total} conexões preparadas.${result.failed ? ' Tente novamente para concluir as pendentes.' : ''}`, result.failed ? 'crit' : 'ok');
      await status.reload();
    } catch (error) { if (alive.current) toast(errorText(error), 'crit'); }
    finally { if (alive.current) setBusy(''); }
  }
  async function configure(event: FormEvent) {
    event.preventDefault(); setBusy('settings');
    try {
      await route('/connectivity', { method: 'PUT', body: JSON.stringify({ projectId, serverUrl, apiKey }) });
      if (!alive.current) return;
      setApiKey(''); setSettingsOpen(false); await status.reload(); toast('Servidor WhatsApp validado e configuração protegida salva para o projeto.');
    } catch (error) { if (alive.current) toast(errorText(error), 'crit'); }
    finally { if (alive.current) setBusy(''); }
  }
  const data = status.data;
  const connected = data?.configured;
  return <>
    <PageHead title="Conectividade" description="Conecte seu WhatsApp para enviar RTPs, relatórios de viagem e outros documentos do projeto."
      actions={<button className="btn" disabled={!!busy || status.loading} onClick={() => { void status.reload(); void history.reload(); }}><RefreshCw />Atualizar estado</button>} />
    <div className="connectivity-grid">
      <section className="panel panel-pad">
        <div className="connectivity-heading"><div className={`connectivity-symbol ${connected ? 'connected' : ''}`}><Link2 /></div><div><h2>Meu WhatsApp</h2><p className="muted">Uma conexão exclusiva para sua conta neste projeto.</p></div></div>
        {status.error ? <Notice tone="crit" title="Não foi possível consultar sua conexão">{status.error}<p>Use Atualizar estado para tentar novamente.</p></Notice> : !data ? <Skeleton /> : <>
          <Tag tone={connected ? 'ok' : data.state === 'unavailable' ? 'warn' : 'info'}>{connected ? 'Conectado' : data.state === 'connecting' ? 'Aguardando leitura do QR Code' : data.state === 'unavailable' ? 'Conexão não confirmada' : 'Aguardando conexão'}</Tag>
          {data.stateError && <div style={{marginTop:16}}><Notice tone="warn">{data.stateError}</Notice></div>}
          {data.code === 'CONFIG_MISSING' && canManage && <p>Configure o servidor no painel ao lado para habilitar o pareamento neste ambiente.</p>}
          {data.instance && <p className="muted connectivity-instance">{data.instance}</p>}
          {!connected && <>
            <p>No celular, abra <b>WhatsApp → Aparelhos conectados → Conectar um aparelho</b> e escaneie o código abaixo.</p>
            {qr ? <div className="connectivity-qr"><img src={qr} width={280} height={280} alt="QR Code para conectar o WhatsApp da sua conta ao projeto atual" /><small>Este código é temporário. Gere outro se expirar.</small></div> : <div className="connectivity-qr-placeholder"><QrCode /><span>{expired ? 'O código expirou. Gere um novo QR Code.' : 'Gere o QR Code para conectar seu aparelho.'}</span></div>}
            <button className="btn btn-primary" disabled={!!busy || !data.provisionAvailable} onClick={() => void connect()}><QrCode />{busy === 'connect' ? 'Preparando conexão…' : qr || expired ? 'Gerar novo QR Code' : data.code === 'INSTANCE_KEY_UNREADABLE' || data.code === 'INSTANCE_AUTH_FAILED' ? 'Reconectar meu WhatsApp' : 'Conectar meu WhatsApp'}</button>
          </>}
          {connected && <Notice tone="ok">Conexão pronta. Use o ícone Enviar documento nas telas de relatórios e arquivos.</Notice>}
        </>}
      </section>
      <section className="panel panel-pad">
        <h2>Documentos pelo WhatsApp</h2><p>O envio está disponível nos RTPs, na prestação de contas de viagens, nos planos e nas evidências. Você escolhe o destinatário e confere o documento antes de enviar.</p>
        <p className="muted">Cada envio usa o WhatsApp da conta autenticada no projeto selecionado.</p>
        {canManage && <div className="stack" style={{marginTop:24}}>
          <button className="btn" disabled={!!busy} onClick={() => setSettingsOpen(value => !value)}><Settings />{settingsOpen ? 'Fechar configuração do servidor' : 'Configurar servidor WhatsApp'}</button>
          {settingsOpen && <form className="stack" onSubmit={configure}>
            <label className="field">Endereço do servidor Evolution<input type="url" required value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="https://whatsapp.suaempresa.com" /></label>
            <label className="field">Chave administrativa<input type="password" autoComplete="new-password" required value={apiKey} onChange={e => setApiKey(e.target.value)} maxLength={1000} /><small>A chave será validada e armazenada de forma protegida para este projeto.</small></label>
            <button className="btn btn-primary" disabled={!!busy}>{busy === 'settings' ? 'Validando…' : 'Validar e salvar configuração'}</button>
          </form>}
          <button className="btn" disabled={!!busy || !data?.provisionAvailable} onClick={() => void prepareProject()}><Users />{busy === 'project' ? 'Preparando…' : 'Preparar conexões dos usuários do projeto'}</button>
          <small className="muted">A preparação cria os vínculos individuais. Cada usuário conecta o próprio celular pela sua conta.</small>
        </div>}
      </section>
    </div>
    <section className="panel" style={{marginTop:24}}><div className="panel-head"><div><h2>Meus envios recentes</h2><p>Solicitações feitas pela sua conta neste projeto. Aceitação pelo servidor não confirma a entrega ao celular.</p></div></div>
      {history.error ? <div className="panel-pad"><Notice tone="warn">{history.error}</Notice></div> : !history.data ? <Skeleton /> : !history.data.length ? <Empty title="Nenhum envio registrado">Os documentos enviados por você aparecerão aqui.</Empty> : <div className="table-wrap"><table className="ledger"><thead><tr><th>Documento</th><th>Destinatário</th><th>Situação</th><th>Data</th></tr></thead><tbody>{history.data.map(row => <tr key={row.id}><td>{row.file_name}{row.source_version && <small>Versão {row.source_version}</small>}</td><td>{row.recipient}</td><td><Tag tone={row.status === 'accepted' ? 'ok' : row.status === 'sending' ? 'info' : 'warn'}>{row.status === 'accepted' ? 'Aceito pelo servidor' : row.status === 'sending' ? 'Enviando' : 'Conferir no WhatsApp'}</Tag></td><td>{new Intl.DateTimeFormat('pt-BR', {dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(row.created_at))}</td></tr>)}</tbody></table></div>}
    </section>
  </>;
}
