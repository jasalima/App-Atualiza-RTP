import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { FileText, Upload, X } from 'lucide-react';
import { plans as plansApi, scholars as scholarsApi } from '../api';
import type { ImportResult } from '../types';
import { Notice, PageHead, Skeleton, Tag, errorText, useAsync, useScope, useToast } from '../ui';

const resultTone = { extracted: 'ok', unidentified: 'warn', ambiguous: 'warn', rejected: 'crit' } as const;
const resultLabel = { extracted: 'Extraído', unidentified: 'Bolsista não identificado', ambiguous: 'Identificação ambígua', rejected: 'Recusado' };

export default function Plans() {
  const { project } = useScope(), toast = useToast();
  const list = useAsync(() => scholarsApi.list(project!.id), [project?.id]);
  const [mode, setMode] = useState<'auto' | 'one'>('auto'), [scholarId, setScholarId] = useState('');
  const [files, setFiles] = useState<File[]>([]), [over, setOver] = useState(false), [busy, setBusy] = useState(false), [results, setResults] = useState<ImportResult[]>([]);
  // Copy the FileList right away: the browser empties it once the input is reset
  // or the drop event ends, before React runs the state updater.
  const add = (incoming: FileList | null) => {
    const picked = Array.from(incoming ?? []);
    if (picked.length) setFiles((cur) => [...cur, ...picked.filter((f) => !cur.some((c) => c.name === f.name && c.size === f.size))]);
  };

  async function upload() {
    const fd = new FormData();
    fd.set('projectId', project!.id);
    if (mode === 'one') fd.set('scholarId', scholarId || list.data![0].id);
    files.forEach((f) => fd.append('files', f));
    setBusy(true);
    try {
      const r = await plansApi.import(fd);
      setResults(r); setFiles([]);
      const ok = r.filter((x) => x.status === 'extracted').length;
      toast(ok ? `${ok} de ${r.length} plano(s) extraído(s). Confira cada um antes de usar.` : 'Nenhum plano foi extraído. Veja os motivos abaixo.', ok ? 'ok' : 'crit');
      void list.reload();
    } catch (x) { toast(errorText(x), 'crit'); } finally { setBusy(false); }
  }

  const step = results.length ? 3 : files.length ? 2 : 1;
  return <>
    <PageHead title="Planos de Trabalho" description="Envie os planos individuais em PDF ou DOCX. O texto é extraído, organizado em objetivos, metas, atividades e produtos e fica aguardando sua conferência." />
    <ol className="steps">
      {['Selecionar arquivos', 'Extrair e identificar', 'Conferir cada plano', 'Confirmar'].map((s, i) => <li key={s} data-state={i + 1 < step ? 'done' : i + 1 === step ? 'current' : undefined}>{s}</li>)}
    </ol>
    {!list.data ? <Skeleton /> : !list.data.length ? <Notice tone="warn" title="Cadastre os bolsistas primeiro">A importação vincula cada plano a um bolsista já cadastrado. <NavLink to="/scholars">Ir para bolsistas</NavLink></Notice> :
      <div className="split">
        <section className="panel">
          <div className="panel-head"><div><h2>Arquivos</h2><p>PDF ou DOCX com texto, até 20 MB cada e 30 por envio.</p></div></div>
          <div className="panel-pad">
            <label className="drop" data-over={over} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
              <Upload /><b>Arraste os planos aqui ou clique para escolher</b><small>Pode selecionar vários de uma vez</small>
              <input type="file" accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
            </label>
            {files.map((f) => <div className="file-row" key={f.name + f.size}><FileText /><div className="grow"><b>{f.name}</b><small>{(f.size / 1024 / 1024).toFixed(2)} MB{f.name.toLowerCase().endsWith('.doc') ? ', formato .doc legado será recusado: salve como .docx' : ''}</small></div><button className="icon-btn" onClick={() => setFiles(files.filter((x) => x !== f))} aria-label={`Remover ${f.name}`}><X /></button></div>)}
            <div style={{ marginTop: 16 }}><button className="btn btn-primary btn-block" disabled={!files.length || busy} onClick={upload}>{busy ? 'Extraindo e identificando…' : `Importar ${files.length || ''} arquivo(s)`.replace('  ', ' ')}</button></div>
          </div>
        </section>
        <aside className="panel panel-pad">
          <h3 style={{ fontSize: 18, marginBottom: 12 }}>A quem pertence cada plano</h3>
          <div style={{ display: 'grid', gap: 10, fontSize: 14 }}>
            <label style={{ display: 'flex', gap: 8 }}><input type="radio" name="mode" checked={mode === 'auto'} onChange={() => setMode('auto')} style={{ width: 16, height: 16 }} /><span><b>Identificar pelo nome no documento</b><br /><span className="muted">Cada arquivo é associado ao bolsista cujo nome completo aparece no texto. Arquivos sem correspondência ficam de fora.</span></span></label>
            <label style={{ display: 'flex', gap: 8 }}><input type="radio" name="mode" checked={mode === 'one'} onChange={() => setMode('one')} style={{ width: 16, height: 16 }} /><span><b>Todos para um bolsista</b><br /><span className="muted">Use quando o plano não traz o nome completo.</span></span></label>
            {mode === 'one' && <select value={scholarId || list.data[0].id} onChange={(e) => setScholarId(e.target.value)} aria-label="Bolsista">{list.data.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>}
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>O conteúdo dos documentos é tratado apenas como dado. Uma nova importação cria outra versão do plano; a anterior fica no histórico.</p>
        </aside>
      </div>}

    {results.length > 0 && <section className="panel" style={{ marginTop: 24 }}>
      <div className="panel-head"><div><h2>Resultado da importação</h2><p>Planos extraídos ficam “a conferir” até alguém revisar os itens.</p></div></div>
      <div className="table-wrap"><table className="ledger"><thead><tr><th>Arquivo</th><th>Bolsista</th><th>Itens</th><th>Cronograma</th><th>Situação</th><th /></tr></thead>
        <tbody>{results.map((r) => <tr key={r.file}><td>{r.file}{r.message && <div className="muted" style={{ fontSize: 13 }}>{r.message}</div>}</td><td>{r.scholarName ?? '—'}</td><td className="num">{r.itemCount ?? '—'}</td><td>{r.status === 'extracted' ? (r.scheduled ? <Tag tone="ok">{r.scheduled} atividade(s) com meses</Tag> : <Tag tone="warn">Não encontrado</Tag>) : '—'}</td><td><Tag tone={resultTone[r.status]}>{resultLabel[r.status]}</Tag></td>
          <td>{r.status === 'extracted' && <NavLink className="btn btn-sm btn-primary" to={`/plans/${r.scholarId}`}>Conferir</NavLink>}</td></tr>)}</tbody></table></div>
    </section>}

    {list.data && list.data.some((s) => s.plan && s.plan.status !== 'confirmed') && !results.length && <section className="panel" style={{ marginTop: 24 }}>
      <div className="panel-head"><div><h2>Aguardando conferência</h2></div></div>
      <ul className="checks">{list.data.filter((s) => s.plan && s.plan.status !== 'confirmed').map((s) => <li key={s.id}><div>{s.full_name}<small>Versão {s.plan!.version}</small></div><NavLink className="btn btn-sm" to={`/plans/${s.id}`}>Conferir</NavLink></li>)}</ul>
    </section>}
  </>;
}
