import { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { plans as plansApi, scholars as scholarsApi } from '../api';
import type { PlanItem } from '../types';
import { Empty, Notice, PageHead, Skeleton, Tag, errorText, itemTypes, useAsync, useScope, useToast } from '../ui';
import { Cronograma, gridMonths } from '../Cronograma';
import { describeMonths, monthEnd, monthStart } from '@/lib/schedule';

// Human conference of the automatic extraction (spec §6): every item can be
// reclassified, corrected, rescheduled month by month or removed before the plan is confirmed.
export default function PlanReview() {
  const { scholarId } = useParams(), { user } = useScope(), toast = useToast(), nav = useNavigate();
  const { data, error } = useAsync(() => scholarsApi.detail(scholarId!), [scholarId]);
  const [items, setItems] = useState<PlanItem[]>([]), [dirty, setDirty] = useState<Set<string>>(new Set()), [identity, setIdentity] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setItems(data.planItems); setIdentity(data.plan?.functional_identity || data.scholar.role_area || ''); } }, [data]);
  if (error) return <Notice tone="crit">{error}</Notice>;
  if (!data) return <Skeleton />;
  const { scholar, plan } = data;
  const change = (id: string, patch: Partial<PlanItem>) => { setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x))); setDirty((d) => new Set(d).add(id)); };
  // Toggling a month keeps starts_on/ends_on as the span of the marked months.
  const toggleMonth = (item: PlanItem, month: string) => {
    const set = new Set(item.scheduled_months ?? []);
    set.has(month) ? set.delete(month) : set.add(month);
    const months = [...set].sort();
    change(item.id, { scheduled_months: months, starts_on: months.length ? monthStart(months[0]) : null, ends_on: months.length ? monthEnd(months[months.length - 1]) : null });
  };
  const activities = items.filter((x) => x.item_type === 'activity');
  const unscheduled = activities.filter((x) => !x.scheduled_months?.length);

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
        <div className="panel-head"><div><h2>Cronograma de atividades individualizado</h2><p>Meses em que cada atividade está prevista, lidos das marcações X do plano. Clique numa célula para marcar ou desmarcar um mês. O RTP usa esta grade para saber o que estava programado em cada período.</p></div></div>
        {unscheduled.length > 0 && <div style={{ padding: '12px 24px 0' }}><Notice tone="warn" title={`${unscheduled.length} atividade(s) sem meses marcados`}>Sem meses, a atividade é tratada como prevista em qualquer período. Marque os meses conforme o cronograma do plano.</Notice></div>}
        {activities.length ? <Cronograma items={activities} months={gridMonths(activities, scholar.starts_on, scholar.ends_on)} onToggle={toggleMonth} /> : <Empty title="Nenhuma atividade classificada">Classifique os itens do tipo atividade abaixo para montar o cronograma.</Empty>}
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Itens extraídos</h2><p>Corrija o tipo ou o texto de cada item. A ordem segue o documento.</p></div></div>
        <div className="conf-row head-row"><span>Tipo</span><span>Texto extraído</span><span /></div>
        {items.map((x) => <div className="conf-row" key={x.id}>
          <select value={x.item_type} onChange={(e) => change(x.id, { item_type: e.target.value as PlanItem['item_type'] })} aria-label="Tipo do item">{Object.entries(itemTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <div><textarea value={x.title} onChange={(e) => { change(x.id, { title: e.target.value }); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`; }} aria-label="Texto do item" />
            <div className="src">{x.source_reference?.manual ? 'Incluído manualmente' : x.source_reference?.section === 'general' ? 'Objetivo geral' : x.source_reference?.section === 'cronograma' ? 'Encontrado só no cronograma' : `Origem: ${x.source_reference?.file ?? 'documento'}${x.source_reference?.line ? `, linha ${x.source_reference.line}` : ''}`}
              {x.item_type === 'activity' && <>, {x.scheduled_months?.length ? `prevista de ${describeMonths(x.scheduled_months)}` : 'sem meses no cronograma'}</>}
              {dirty.has(x.id) && <span className="dirty"> alterado</span>}</div></div>
          <button className="icon-btn" onClick={() => removeItem(x.id)} aria-label="Remover item"><Trash2 /></button>
        </div>)}
        <div style={{ padding: '14px 24px' }}><button className="btn btn-sm" onClick={addItem}><Plus />Incluir item que a leitura não encontrou</button></div>
      </section>
    </div>}
  </>;
}
