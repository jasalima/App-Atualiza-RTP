import { useState, type FormEvent } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { projects as projectsApi } from '../api';
import type { Project } from '../types';
import { Drawer, Empty, PageHead, Tag, errorText, fmtPeriod, useScope, useToast } from '../ui';

const FAPTO = 'Fundação de Apoio Científico e Tecnológico do Tocantins – FAPTO';

export default function Projects() {
  const { projects, project: focus, setProjectId, reloadProjects, canManage } = useScope();
  const toast = useToast();
  const [editing, setEditing] = useState<Project | 'new' | null>(null), [busy, setBusy] = useState(false);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (body.endsOn < body.startsOn) return toast('A data de encerramento é anterior à de início.', 'crit');
    setBusy(true);
    try {
      const saved = editing === 'new' ? await projectsApi.create(body) : await projectsApi.update((editing as Project).id, body);
      await reloadProjects(); setProjectId(saved.id); setEditing(null);
      toast(editing === 'new' ? 'Projeto cadastrado.' : 'Projeto atualizado.');
    } catch (x) { toast(errorText(x), 'crit'); } finally { setBusy(false); }
  }
  const p = editing && editing !== 'new' ? editing : null;

  return <>
    <PageHead title="Projetos" description="Os dados institucionais do projeto preenchem automaticamente o cabeçalho e o encerramento de cada RTP."
      actions={canManage && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus />Cadastrar projeto</button>} />
    {projects.length ? <div className="stack">{projects.map((x) => <section className="panel" key={x.id}>
      <div className="panel-head">
        <div><h2>{x.title}</h2><p>{x.executing_institution}</p></div>
        <div className="head-actions">
          {focus?.id === x.id ? <Tag tone="info">Em foco</Tag> : <button className="btn btn-sm" onClick={() => setProjectId(x.id)}>Colocar em foco</button>}
          {canManage && <button className="btn btn-sm btn-quiet" onClick={() => setEditing(x)}><Pencil />Editar</button>}
        </div>
      </div>
      <div className="panel-pad" style={{ paddingTop: 4 }}>
        <dl className="facts">
          <div><dt>Coordenação geral</dt><dd>{x.coordinator}</dd></div>
          <div><dt>Vigência</dt><dd>{fmtPeriod(x.starts_on, x.ends_on)}</dd></div>
          <div><dt>Município de emissão</dt><dd>{x.city}</dd></div>
          <div><dt>Fundação de apoio</dt><dd>{x.support_foundation === FAPTO ? 'FAPTO' : x.support_foundation}</dd></div>
          <div><dt>Situação</dt><dd><Tag status={x.status} /></dd></div>
        </dl>
        {x.general_objective && <p style={{ marginTop: 14, maxWidth: '75ch' }}><span className="muted">Objetivo geral. </span>{x.general_objective}</p>}
      </div>
    </section>)}</div> : <div className="panel"><Empty title="Nenhum projeto cadastrado" action={canManage && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus />Cadastrar projeto</button>}>Comece pelo projeto do Polo de Agricultura Irrigada. Outros projetos podem ser adicionados depois.</Empty></div>}

    <Drawer open={!!editing} onClose={() => setEditing(null)} title={p ? 'Editar projeto' : 'Cadastrar projeto'} description="Esses dados aparecem no cabeçalho do Formulário 9.">
      <form className="grid-form" onSubmit={save} key={p?.id ?? 'new'}>
        <label className="field span-2">Título completo do projeto<textarea name="title" required minLength={5} defaultValue={p?.title ?? 'Elaboração do Plano de Desenvolvimento Sustentável do Polo de Agricultura Irrigada do Sudoeste do Tocantins'} style={{ minHeight: 64 }} /></label>
        <label className="field span-2">Projeto/convênio (formulários FAPTO)<input name="agreement" defaultValue={p?.agreement ?? ''} placeholder="Ex.: 7886-6 “Título do projeto” - CONVÊNIO Nº 29/2026" /><small>Linha “Projeto/convênio” do Formulário 26. Em branco, usa o título do projeto.</small></label>
        <label className="field span-2">Instituição executora<input name="executingInstitution" required defaultValue={p?.executing_institution} /></label>
        <label className="field span-2">Fundação de apoio<input name="supportFoundation" defaultValue={p?.support_foundation ?? FAPTO} /></label>
        <label className="field">Coordenação geral<input name="coordinator" required defaultValue={p?.coordinator} /></label>
        <label className="field">Município de emissão<input name="city" defaultValue={p?.city ?? 'Palmas – TO'} /><small>Usado em “Palmas – TO, data”.</small></label>
        <label className="field">Início<input name="startsOn" type="date" required defaultValue={p?.starts_on} /></label>
        <label className="field">Encerramento<input name="endsOn" type="date" required defaultValue={p?.ends_on} /></label>
        <label className="field">Situação<select name="status" defaultValue={p?.status ?? 'active'}><option value="active">Ativo</option><option value="suspended">Suspenso</option><option value="finished">Encerrado</option></select></label>
        <label className="field span-2">Descrição<textarea name="description" defaultValue={p?.description} /></label>
        <label className="field span-2">Objetivo geral<textarea name="generalObjective" defaultValue={p?.general_objective} /></label>
        <div className="form-foot span-2"><button type="button" className="btn btn-quiet" onClick={() => setEditing(null)}>Cancelar</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : p ? 'Salvar alterações' : 'Cadastrar projeto'}</button></div>
      </form>
    </Drawer>
  </>;
}
