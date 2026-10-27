import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Download } from 'lucide-react';
import { download, scholars } from '../api';
import type { ScholarOverview } from '../types';
import SendDocumentButton from '../SendDocumentButton';
import { Notice, PageHead, Skeleton, errorText, useScope, useToast } from '../ui';
export default function TravelAccountability() {
  const { project, user, canManage } = useScope();
  return <TravelSection key={`${user.id}:${project!.id}`} projectId={project!.id} scholarId={user.scholarId} canManage={canManage} />;
}
function TravelSection({ projectId, scholarId, canManage }: { projectId: string; scholarId?: string | null; canManage: boolean }) {
  const toast = useToast();
  const [members, setMembers] = useState<ScholarOverview[]>([]), [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    scholars.list(projectId).then(rows => {
      if (!active) return;
      const allowed = canManage ? rows : rows.filter(row => row.id === scholarId);
      setMembers(allowed); setSelected(allowed[0]?.id || '');
    }).catch(e => { if (active) setError(errorText(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, scholarId, canManage]);
  const member = members.find(row => row.id === selected);
  async function exportFile(format: 'pdf' | 'docx') {
    setBusy(true);
    try { await download(`/travel/export?projectId=${projectId}&scholarId=${selected}&format=${format}`, `Formulario-26-${member!.full_name}.${format}`); }
    catch (e) { toast(errorText(e), 'crit'); } finally { setBusy(false); }
  }
  return <>
    <PageHead title="Prestação de contas de diárias e passagens" description="Formulário 26 da FAPTO. Gere o termo do beneficiário para preenchimento dos dados da viagem." />
    {error ? <Notice tone="crit">{error}</Notice> : loading ? <Skeleton /> : <section className="panel panel-pad">
      <label className="field">Beneficiário<select value={selected} onChange={e => setSelected(e.target.value)} disabled={busy || !members.length}>{!members.length && <option value="">Nenhum membro disponível</option>}{members.map(row => <option key={row.id} value={row.id}>{row.full_name}</option>)}</select></label>
      {!members.length && <Notice>Cadastre um membro ou solicite à coordenação o vínculo da sua conta ao beneficiário.</Notice>}
      {member && <>
        <dl className="facts" style={{margin:'20px 0'}}><div><dt>Nome</dt><dd>{member.full_name}</dd></div><div><dt>Função</dt><dd>{member.role_area || 'Em branco no documento'}</dd></div><div><dt>Telefone</dt><dd>{member.phone || 'Não cadastrado'}</dd></div><div><dt>E-mail</dt><dd>{member.email || 'Em branco no documento'}</dd></div></dl>
        <Notice>Cidade de origem, destino, saída, retorno, pagamento da diária e descrição da viagem ficam em branco. O quadro mantém os espaços de data e assinatura do beneficiário e da coordenação.</Notice>
        <div className="head-actions" style={{marginTop:20}}><button className="btn btn-primary" disabled={busy} onClick={() => void exportFile('docx')}><Download />Baixar DOCX editável</button><button className="btn" disabled={busy} onClick={() => void exportFile('pdf')}><Download />Baixar PDF</button><SendDocumentButton disabled={busy} source={{kind:'travel',id:member.id,label:`Formulário 26 — ${member.full_name}`,scholarId:member.id}} /></div>
        <p className="muted">O DOCX pode ser preenchido no Word ou LibreOffice. O PDF está pronto para impressão e preenchimento manual.</p>
        <p className="muted">Gerencie o WhatsApp e o QR Code em <NavLink to="/connectivity">Conectividade</NavLink>.</p>
      </>}
    </section>}
  </>;
}
