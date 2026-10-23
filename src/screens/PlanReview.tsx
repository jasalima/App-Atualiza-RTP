import { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { plans as plansApi, scholars as scholarsApi } from '../api';
import type { PlanItem } from '../types';
import { Empty, Notice, PageHead, Skeleton, Tag, errorText, itemTypes, useAsync, useScope, useToast } from '../ui';

// Human conference of the automatic extraction (spec §6): every item can be
// reclassified, corrected, dated or removed before the plan is confirmed.
export default function PlanReview() {
  const { scholarId } = useParams(), { user } = useScope(), toast = useToast(), nav = useNavigate();
  const { data, error } = useAsync(() => scholarsApi.detail(scholarId!), [scholarId]);
  const [items, setItems] = useState<PlanItem[]>([]), [dirty, setDirty] = useState<Set<string>>(new Set()), [identity, setIdentity] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setItems(data.planItems); setIdentity(data.plan?.functional_identity || data.scholar.role_area || ''); } }, [data]);
  if (error) return <Notice tone="crit">{error}</Notice>;
  if (!data) return <Skeleton />;
  const { scholar, plan } = data;
  const change = (id: string, patch: Partial<PlanItem>) => { setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x))); setDirty((d) => new Set(d).add(id)); };

  async function persist() {
    await Promise.all(items.filter((x) => dirty.has(x.id)).map((x) => plansApi.updateItem(x.id, x)));
    setDirty(new Set());
  }
  async function saveDraft() { setBusy(true); try { await persist(); toast('Alterações salvas.'); } catch (x) { toast(errorText(x), 'crit'); } finally { setBusy(false); } }
  async function confirmPlan() {
    if (!items.some((x) => x.item_type === 'objective')) return toast('Classifique ao menos um objetivo individual antes de confirmar.', 'crit');
    if (!items.some((x) => x.item_type === 'activity')) return toast('Classifique ao menos uma atividade prevista antes de confirmar.', 'crit');
    if (identity.trim().length < 10) return toast('Descreva a responsabilidade do bolsista no projeto.', 'crit');
    setBusy(true);
    try { await persist(); await plansApi.confirm(plan!.id, user.id, identity.trim()); toast('Plano conferido e confirmado.'); nav(`/scholars/${scholar.id}`); }
    catch (x) { toast(errorText(x), 'crit'); } finally { setBusy(false); }
  }
  async function addItem() {
    try { const item = await plansApi.addItem(plan!.id, scholar, items.length); setItems((xs) => [...xs, item]); } catch (x) { toast(errorText(x), 'crit'); }
  }
  async function removeItem(id: string) {
    try { await plansApi.removeItem(id); setItems((xs) => xs.filter((x) => x.id !== id)); } catch (x) { toast(errorText(x), 'crit'); }
  }
  const counts = Object.keys(itemTypes).map((t) => [t, items.filter((i) => i.item_type === t).length] as const);

  return <>
    <PageHead back={<NavLink to={`/scholars/${scholar.id}`} className="back"><ArrowLeft />{scholar.full_name}</NavLink>}
      title="Conferência do plano"
      description={plan ? `Versão ${plan.version}${plan.documents?.original_name ? ` extraída de ${plan.documents.original_name}` : ''}. Corrija o que a leitura automática classificou errado; o RTP usará exatamente esta lista.` : undefined}
      actions={plan && <><button className="btn" onClick={saveDraft} disabled={busy || !dirty.size}>Salvar rascunho</button><button className="btn btn-go" onClick={confirmPlan} disabled={busy}>{plan.status === 'confirmed' ? 'Confirmar novamente' : 'Confirmar plano'}</button></>} />
    {!plan ? <div className="panel"><Empty title="Nenhum plano importado" action={<NavLink className="btn btn-primary" to="/plans">Importar plano</NavLink>}>Importe o Plano de Trabalho deste bolsista para conferir.</Empty></div> : <div className="stack">
      {plan.status === 'confirmed' && <Notice tone="ok" title="Este plano já foi confirmado">Alterações feitas aqui valem para os próximos RTPs. Relatórios já gerados mantêm suas versões.</Notice>}
      <section className="panel panel-pad">
        <label className="field">Responsabilidade do bolsista no projeto<small>Identificação funcional segundo o documento. Não atribua funções que o plano não prevê.</small><textarea value={identity} onChange={(e) => setIdentity(e.target.value)} /></label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>{counts.map(([t, n]) => <Tag key={t} tone={n ? (t === 'objective' || t === 'activity' ? 'ok' : 'info') : t === 'objective' || t === 'activity' ? 'warn' : 'mute'}>{itemTypes[t]}: {n}</Tag>)}</div>
      </section>
      <section className="panel">
        <div className="conf-row head-row"><span>Tipo</span><span>Texto extraído</span><span>Início previsto</span><span>Fim previsto</span><span /></div>
        {items.map((x) => <div className="conf-row" key={x.id}>
          <select value={x.item_type} onChange={(e) => change(x.id, { item_type: e.target.value as PlanItem['item_type'] })} aria-label="Tipo do item">{Object.entries(itemTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <div><textarea value={x.title} onChange={(e) => { change(x.id, { title: e.target.value }); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`; }} aria-label="Texto do item" />
            <div className="src">{x.source_reference?.manual ? 'Incluído manualmente' : `Origem: ${x.source_reference?.file ?? 'documento'}${x.source_reference?.line ? `, linha ${x.source_reference.line}` : ''}`}{dirty.has(x.id) && <span className="dirty"> alterado</span>}</div></div>
          <input type="date" value={x.starts_on ?? ''} onChange={(e) => change(x.id, { starts_on: e.target.value })} aria-label="Início previsto" />
          <input type="date" value={x.ends_on ?? ''} onChange={(e) => change(x.id, { ends_on: e.target.value })} aria-label="Fim previsto" />
          <button className="icon-btn" onClick={() => removeItem(x.id)} aria-label="Remover item"><Trash2 /></button>
        </div>)}
        <div style={{ padding: '14px 24px' }}><button className="btn btn-sm" onClick={addItem}><Plus />Incluir item que a leitura não encontrou</button></div>
      </section>
    </div>}
  </>;
}
