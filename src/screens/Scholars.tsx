import { useState, type FormEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { scholars as scholarsApi } from '../api';
import type { Scholar } from '../types';
import { Drawer, Empty, Notice, PageHead, Pivot, Skeleton, Tag, errorText, fmtPeriod, nextStep, sectorsOf, useAsync, useScope, useToast } from '../ui';

export function ScholarForm({ scholar, onSaved, onCancel }: { scholar: Scholar | null; onSaved: (s: Scholar) => void; onCancel: () => void }) {
  const { project } = useScope(), toast = useToast(), [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (body.endsOn < body.startsOn) return toast('A vigência final é anterior à inicial.', 'crit');
    setBusy(true);
    try { onSaved(scholar ? await scholarsApi.update(scholar.id, body) : await scholarsApi.create(project!.id, body)); }
    catch (x) { toast(/duplicate|unique/i.test(errorText(x)) ? 'Já existe um bolsista com esse nome neste projeto.' : errorText(x), 'crit'); }
    finally { setBusy(false); }
  }
  return <form className="grid-form" onSubmit={save}>
    <label className="field span-2">Nome completo<input name="fullName" required defaultValue={scholar?.full_name} /><small>Use o nome exatamente como aparece no Plano de Trabalho: é por ele que a importação identifica o bolsista.</small></label>
    <label className="field">Função ou área de atuação<input name="roleArea" defaultValue={scholar?.role_area} /></label>
    <label className="field">Modalidade da bolsa<input name="scholarshipType" defaultValue={scholar?.scholarship_type} /></label>
    <label className="field">Vigência inicial<input name="startsOn" type="date" required defaultValue={scholar?.starts_on} /></label>
    <label className="field">Vigência final<input name="endsOn" type="date" required defaultValue={scholar?.ends_on} /></label>
    <label className="field">Situação da bolsa<select name="status" defaultValue={scholar?.status ?? 'active'}><option value="active">Ativa</option><option value="suspended">Suspensa</option><option value="finished">Encerrada</option></select></label>
    <label className="field span-2">Observações administrativas<textarea name="notes" defaultValue={scholar?.notes} /></label>
    <div className="form-foot span-2"><button type="button" className="btn btn-quiet" onClick={onCancel}>Cancelar</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : scholar ? 'Salvar alterações' : 'Cadastrar bolsista'}</button></div>
  </form>;
}

export default function Scholars() {
  const { project, canManage } = useScope(), toast = useToast();
  const list = useAsync(() => scholarsApi.list(project!.id), [project?.id]);
  const [adding, setAdding] = useState(false), [q, setQ] = useState('');
  const rows = (list.data ?? []).filter((s) => `${s.full_name} ${s.role_area}`.toLowerCase().includes(q.toLowerCase()));
  return <>
    <PageHead title="Bolsistas" description="Cada bolsista tem plano, execução e relatórios próprios. Nada de um perfil é usado no relatório de outro."
      actions={canManage && <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus />Cadastrar bolsista</button>} />
    {list.error ? <Notice tone="crit">{list.error}</Notice> : list.loading && !list.data ? <Skeleton /> :
      <section className="panel">
        <div className="toolbar"><input className="grow" type="search" placeholder="Buscar por nome ou área" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar bolsista" /></div>
        <div className="table-wrap"><table className="ledger">
          <thead><tr><th>Bolsista</th><th>Vigência</th><th>Plano</th><th>RTPs</th><th>Próxima etapa</th><th>Bolsa</th></tr></thead>
          <tbody>{rows.map((s) => <tr key={s.id}>
            <td><NavLink className="who" to={`/scholars/${s.id}`}><Pivot sectors={sectorsOf(s)} size={26} /><div>{s.full_name}<small>{s.role_area || 'Área não informada'}</small></div></NavLink></td>
            <td className="num">{fmtPeriod(s.starts_on, s.ends_on)}</td>
            <td>{s.plan ? `Versão ${s.plan.version}` : <span className="muted">—</span>}</td>
            <td className="num">{s.reports.length}</td>
            <td>{nextStep(s)}</td>
            <td><Tag status={s.status} /></td>
          </tr>)}</tbody>
        </table></div>
        {!rows.length && <Empty title={q ? 'Nenhum bolsista encontrado' : 'Nenhum bolsista cadastrado'}>{q ? 'Revise o termo de busca.' : 'Cadastre os bolsistas antes de importar os planos individuais.'}</Empty>}
      </section>}
    <Drawer open={adding} onClose={() => setAdding(false)} title="Cadastrar bolsista" description={project?.title}>
      <ScholarForm scholar={null} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); toast('Bolsista cadastrado.'); void list.reload(); }} />
    </Drawer>
  </>;
}
