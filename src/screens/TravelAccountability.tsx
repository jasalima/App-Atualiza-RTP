import { useEffect, useState } from 'react';
import { Download, MessageCircle, Settings } from 'lucide-react';
import { download, route, scholars } from '../api';
import type { ScholarOverview } from '../types';
import { Drawer, Notice, PageHead, Skeleton, errorText, useScope, useToast } from '../ui';

export default function TravelAccountability() {
  const { project, user, canManage } = useScope();
  // Remount all selections, credentials and pending state when the tenant or user changes.
  return <TravelSection key={`${user.id}:${project!.id}`} projectId={project!.id} scholarId={user.scholarId} canManage={canManage} />;
}
function TravelSection({ projectId, scholarId, canManage }: { projectId: string; scholarId?: string | null; canManage: boolean }) {
  const toast = useToast();
  const [members, setMembers] = useState<ScholarOverview[]>([]), [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState({ configured: false, instance: '', state: 'not_created', stateError: '', provisionAvailable: false }), [open, setOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null), [format, setFormat] = useState<'pdf' | 'docx'>('pdf');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let active = true;
    scholars.list(projectId).then(rows => {
      if (!active) return;
      const allowed = canManage ? rows : rows.filter(s => s.id === scholarId);
      setMembers(allowed); setSelected(allowed[0]?.id || '');
    }).catch(e => { if (active) setError(errorText(e)); }).finally(() => { if (active) setLoading(false); });
    void route<typeof connection>(`/travel/connection?projectId=${projectId}`).then(config => { if (active) setConnection(config); }).catch(() => { if (active) setConnection(c => ({ ...c, stateError: 'Não foi possível consultar sua conexão. Abra Conexão WhatsApp para tentar novamente.' })); });
    return () => { active = false; };
  }, [projectId, scholarId, canManage]);
  useEffect(() => {
    if (!open) return;
    let active = true, pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { const config = await route<typeof connection>(`/travel/connection?projectId=${projectId}`); if (active) { setConnection(config); if (config.configured) setQr(null); } }
      catch { if (active) setConnection(c => ({ ...c, configured: false, stateError: 'Não foi possível consultar a conexão. Tente novamente.' })); }
      finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 8000);
    return () => { active = false; clearInterval(timer); };
  }, [open, projectId]);
  useEffect(() => { if (!qr) return; const timer = setTimeout(() => setQr(null), 60000); return () => clearTimeout(timer); }, [qr]);
  const member = members.find(s => s.id === selected);
  async function exportFile(f: 'pdf' | 'docx') {
    setBusy(true);
    try { await download(`/travel/export?projectId=${projectId}&scholarId=${selected}&format=${f}`, `Formulario-26-${member!.full_name}.${f}`); }
    catch (e) { toast(errorText(e), 'crit'); } finally { setBusy(false); }
  }
  async function connect() {
    setBusy(true); setQr(null);
    try {
      await route('/travel/connection', { method: 'POST', body: JSON.stringify({ projectId, action: 'provision' }) });
      const result = await route<{ connected: boolean; qr: string | null }>('/travel/connection', { method: 'POST', body: JSON.stringify({ projectId, action: 'connect' }) });
      setQr(result.qr);
      setConnection(await route<typeof connection>(`/travel/connection?projectId=${projectId}`));
      if (result.connected) toast('Seu WhatsApp está conectado.');
      else if (!result.qr) toast('O QR Code ainda está sendo preparado. Aguarde e gere novamente.');
    }
    catch (e) { toast(errorText(e), 'crit'); } finally { setBusy(false); }
  }
  async function prepareProject() {
    setBusy(true);
    try {
      const result = await route<{ total: number; prepared: number; failed: number }>('/travel/connection', { method: 'POST', body: JSON.stringify({ projectId, action: 'provisionProject' }) });
      toast(`${result.prepared} de ${result.total} conexões preparadas.${result.failed ? ' Tente novamente para concluir as pendentes.' : ''}`, result.failed ? 'crit' : 'ok');
      setConnection(await route<typeof connection>(`/travel/connection?projectId=${projectId}`));
    } catch (e) { toast(errorText(e), 'crit'); } finally { setBusy(false); }
  }
  async function send() {
    setBusy(true);
    try { await route('/travel/send', { method: 'POST', body: JSON.stringify({ projectId, scholarId: selected, format, requestId: crypto.randomUUID() }) }); setConfirm(false); toast('Documento aceito pela Evolution API para envio.'); }
    catch (e) { setConfirm(false); toast(errorText(e), 'crit'); } finally { setBusy(false); }
  }
  return <>
    <PageHead title="Prestação de contas de diárias e passagens" description="Formulário 26 da FAPTO. Gere o termo do beneficiário para preenchimento dos dados da viagem."
      actions={<button className="btn" onClick={() => setOpen(true)}><Settings />Conexão WhatsApp</button>} />
    {error ? <Notice tone="crit">{error}</Notice> : loading ? <Skeleton /> : <div className="stack">
      <section className="panel panel-pad">
        <label className="field">Beneficiário<select value={selected} onChange={e => { setSelected(e.target.value); setConfirm(false); }} disabled={busy || !members.length}>{!members.length && <option value="">Nenhum membro disponível</option>}{members.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label>
        {!members.length && <Notice>Cadastre um membro ou solicite à coordenação o vínculo da sua conta ao beneficiário.</Notice>}
        {member && <>
          <dl className="facts" style={{ margin: '20px 0' }}><div><dt>Nome</dt><dd>{member.full_name}</dd></div><div><dt>Função</dt><dd>{member.role_area || 'Em branco no documento'}</dd></div><div><dt>Telefone</dt><dd>{member.phone || 'Não cadastrado'}</dd></div><div><dt>E-mail</dt><dd>{member.email || 'Em branco no documento'}</dd></div></dl>
          <Notice>Cidade de origem, destino, saída, retorno, pagamento da diária e descrição da viagem ficam em branco. O quadro mantém os espaços de data e assinatura do beneficiário e da coordenação.</Notice>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20 }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => void exportFile('docx')}><Download />Baixar DOCX editável</button>
            <button className="btn" disabled={busy} onClick={() => void exportFile('pdf')}><Download />Baixar PDF</button>
            <button className="btn" disabled={busy || !connection.configured || !member.phone} onClick={() => setConfirm(true)}><MessageCircle />Enviar pelo WhatsApp</button>
          </div>
          <p className="muted">O DOCX pode ser preenchido no Word ou LibreOffice. O PDF está pronto para impressão e preenchimento manual.</p>
          {!connection.configured && <p className="muted">Abra Conexão WhatsApp e conecte seu celular para habilitar o envio.</p>}
          {!member.phone && <p className="muted">A coordenação deve cadastrar o telefone do membro com DDI e DDD para habilitar o envio.</p>}
        </>}
      </section>
    </div>}
    <Drawer open={open} onClose={() => { if (!busy) { setOpen(false); setQr(null); } }} title="Conexão WhatsApp" description="Uma conexão exclusiva para sua conta neste projeto.">
      <div className="stack">
        <Notice tone={connection.configured ? 'ok' : 'info'} title={connection.configured ? 'WhatsApp conectado' : 'Conecte seu WhatsApp'}>No celular, abra WhatsApp → Aparelhos conectados → Conectar um aparelho e escaneie o QR Code.</Notice>
        {connection.instance && <p className="muted" style={{overflowWrap:'anywhere'}}>Sua instância: {connection.instance}</p>}
        {connection.stateError && <Notice tone="warn">{connection.stateError}</Notice>}
        {qr && !connection.configured && <div style={{textAlign:'center'}}><img src={qr} alt="QR Code para conectar seu WhatsApp a este projeto" width={280} height={280} style={{maxWidth:'100%',height:'auto'}} /><p className="muted">O código expira rapidamente. Gere outro se necessário.</p></div>}
        {!connection.provisionAvailable && <Notice tone="warn">As credenciais da Evolution API precisam estar configuradas no servidor.</Notice>}
        {!connection.configured && <button className="btn btn-primary" disabled={busy || !connection.provisionAvailable} onClick={() => void connect()}>{busy ? 'Preparando…' : qr ? 'Gerar novo QR Code' : 'Conectar meu WhatsApp'}</button>}
        {canManage && <button className="btn" disabled={busy || !connection.provisionAvailable} onClick={() => void prepareProject()}>Preparar conexões dos usuários do projeto</button>}
        <small className="muted">Cada usuário conecta o próprio aparelho. As instâncias Gesproject são criadas automaticamente e as chaves ficam protegidas no servidor.</small>
      </div>
    </Drawer>
    <Drawer open={confirm} onClose={() => { if (!busy) setConfirm(false); }} title="Enviar relatório de viagem" description="Confira o destinatário e o formato antes de enviar.">
      <div className="stack"><p><b>{member?.full_name}</b><br />{member?.phone}</p>
        <label className="field">Documento<select value={format} onChange={e => setFormat(e.target.value as 'pdf' | 'docx')} disabled={busy}><option value="pdf">PDF para impressão</option><option value="docx">DOCX editável</option></select></label>
        <Notice>Será enviado apenas o Formulário 26 deste beneficiário no projeto atual.</Notice>
        <button className="btn btn-primary" disabled={busy} onClick={() => void send()}><MessageCircle />{busy ? 'Enviando…' : 'Enviar documento'}</button>
      </div>
    </Drawer>
  </>;
}
