import { useCallback, useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Download } from 'lucide-react';
import { photos as photosApi, travelReports } from '../api';
import type { TravelPhoto, TravelReport } from '../types';
import SendDocumentButton from '../SendDocumentButton';
import { PhotoManager, TravelFields } from '../TravelFields';
import { SignaturePanel } from './Signatures';
import { Notice, Skeleton, Tag, errorText, useScope, useToast } from '../ui';

export default function TravelReportEditor() {
  const { id } = useParams(), { project, canManage } = useScope(), toast = useToast();
  const [report, setReport] = useState<TravelReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState('');
  const [photos, setPhotos] = useState<TravelPhoto[]>([]), [signLocked, setSignLocked] = useState(false), onLock = useCallback((v: boolean) => setSignLocked(v), []);
  const photoEndpoint = `/travel/reports/${id}/photos?projectId=${project!.id}`;
  // Photos are saved one by one, apart from the form: keep them out of the dirty check.
  const strip = (x: TravelReport) => JSON.stringify({ ...x, photos: undefined, updatedAt: undefined });
  useEffect(() => { travelReports.get(project!.id, id!).then((r) => { setReport(r); setSaved(strip(r)); }, (e) => setError(errorText(e))); }, [project, id]);
  useEffect(() => { photosApi.list(photoEndpoint).then((x) => setPhotos(x.photos), () => setPhotos([])); }, [photoEndpoint]);
  if (error) return <Notice tone="crit" title="Não foi possível abrir o relatório de viagem">{error}</Notice>;
  if (!report) return <Skeleton />;
  const r = report, dirty = strip(r) !== saved;
  const locked = (r.status === 'finalized' && !canManage) || signLocked;
  const set = (patch: Partial<TravelReport>) => setReport({ ...r, ...patch });

  async function save(status: TravelReport['status'] = r.status) {
    setBusy(true);
    try {
      const next = await travelReports.save(project!.id, r.id, { origin: r.origin, destination: r.destination, departureDate: r.departureDate || null, returnDate: r.returnDate || null, paymentDate: r.paymentDate || null, objective: r.objective, entries: r.entries, status });
      const merged = { ...next, beneficiary: r.beneficiary };
      setReport(merged); setSaved(strip(merged));
      toast(status === 'finalized' && r.status !== 'finalized' ? 'Relatório concluído.' : status === 'draft' && r.status === 'finalized' ? 'Relatório reaberto para edição.' : 'Relatório salvo.');
    } catch (e) { toast(errorText(e), 'crit'); } finally { setBusy(false); }
  }
  const file = (format: 'pdf' | 'docx') => travelReports.export(project!.id, r.id, format, `Formulario-26-${(r.scholarName ?? 'membro').replace(/\s+/g, '-')}${r.destination ? `-${r.destination.replace(/[^\p{L}\p{N}]+/gu, '-')}` : ''}.${format}`).catch((e) => toast(errorText(e), 'crit'));
  const b = r.beneficiary;

  return <>
    <NavLink to="/travel" className="back"><ArrowLeft />Diárias e passagens</NavLink>
    <div className="head">
      <div><h1>Relatório de viagem</h1><p>{r.scholarName}{r.destination ? `, viagem a ${r.destination}` : ''}. Formulário 26 da FAPTO.</p></div>
      <div className="head-actions">
        {dirty && <span className="dirty" style={{ alignSelf: 'center' }}>Alterações não salvas</span>}
        <Tag tone={r.status === 'finalized' ? 'ok' : 'info'}>{r.status === 'finalized' ? 'Concluído' : 'Em preenchimento'}</Tag>
        {!locked && <button className="btn" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Salvando…' : 'Salvar'}</button>}
        {r.status === 'draft' && !signLocked && <button className="btn btn-go" disabled={busy} onClick={() => void save('finalized')}><Check />Concluir</button>}
        {r.status === 'finalized' && canManage && !signLocked && <button className="btn" disabled={busy} onClick={() => void save('draft')}>Reabrir</button>}
      </div>
    </div>
    {signLocked ? <div style={{ marginBottom: 18 }}><Notice tone="info" title="Documento com assinatura eletrônica">O conteúdo está bloqueado porque já recebeu assinatura. Para alterar, cancele as assinaturas no painel ao lado.</Notice></div>
      : locked && <div style={{ marginBottom: 18 }}><Notice tone="info" title="Relatório concluído">Para alterar, peça à coordenação para reabri-lo.</Notice></div>}

    <div className="split">
      <div className="stack">
        <section className="panel panel-pad">
          <h3 style={{ fontSize: 18, marginBottom: 10 }}>Identificação do beneficiário</h3>
          <dl className="facts"><div><dt>Nome</dt><dd>{b?.name}</dd></div><div><dt>Função no projeto</dt><dd>{b?.role || 'Não informada'}</dd></div><div><dt>Telefone</dt><dd>{b?.phone || 'Não cadastrado'}</dd></div><div><dt>E-mail</dt><dd>{b?.email || 'Não cadastrado'}</dd></div></dl>
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>Vem do cadastro do membro. Para corrigir, edite o cadastro do bolsista.</p>
        </section>

        <TravelFields r={r} set={set} locked={locked} />
        <PhotoManager endpoint={photoEndpoint} photos={photos} onChange={setPhotos} locked={locked} />
      </div>

      <aside className="side">
        <SignaturePanel kind="travel" sourceId={r.id} scholarId={r.scholarId} dirty={dirty} onLock={onLock} />
        <div className="panel">
          <h3>Documento</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            <button className="btn btn-block" disabled={dirty || busy} onClick={() => void file('docx')}><Download />DOCX editável</button>
            <button className="btn btn-block" disabled={dirty || busy} onClick={() => void file('pdf')}><Download />PDF</button>
            <SendDocumentButton disabled={dirty || busy} className="btn-block" source={{ kind: 'travel', id: r.id, label: `Formulário 26 — ${r.scholarName}${r.destination ? ` (${r.destination})` : ''}`, scholarId: r.scholarId }} />
          </div>
          {dirty && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Salve antes de exportar ou enviar.</p>}
        </div>
        <div className="panel">
          <h3>Lembretes do formulário</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, display: 'grid', gap: 6 }}>
            <li>Anexe os comprovantes do deslocamento (bilhete, hospedagem, refeição, táxi).</li>
            <li>Entregue em até 15 dias corridos após o retorno.</li>
            <li>Envie assinado ao analista do projeto: use “Solicitar assinaturas” para colher as assinaturas pelo link.</li>
          </ul>
        </div>
      </aside>
    </div>
  </>;
}
