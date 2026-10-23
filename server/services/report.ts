import { addMonths, describeMonths, hasSchedule, isScheduledIn, monthNames, monthsBetween, toMonth } from '../../lib/schedule';
import { inThe, mainClause, nominalize, toThe } from '../../lib/nominalize';
import type { ReportContent } from '../types.js';

type LengthMode = 'concise' | 'standard' | 'detailed';
type Input = { project: any; scholar: any; planItems: any[]; executions: any[]; number: string; periodStart: string; periodEnd: string; issuedOn: string; planStatus?: string; functionalIdentity?: string; lengthMode?: LengthMode };
type Nominal = { text: string; feminine: boolean; headLength?: number };

const iso = (date: string | Date) => String(date instanceof Date ? date.toISOString() : date).slice(0, 10);
const fmt = (date: string | Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${iso(date)}T12:00:00Z`));
const monthYear = (date: string | Date) => `${iso(date).slice(5, 7)}/${iso(date).slice(0, 4)}`;
const longDate = (date: string | Date) => { const [y, m, d] = iso(date).split('-'); return `${Number(d)} de ${monthNames[Number(m) - 1]} de ${y}`; };
const join = (values: string[]) => values.filter(Boolean).join('; ');
const bare = (s: string) => String(s ?? '').trim().replace(/[\s;.:,]+$/, '');
const lower = (s: string) => { const b = bare(s); return /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]/.test(b) ? b[0].toLocaleLowerCase('pt-BR') + b.slice(1) : b; };
const upper = (s: string) => { const b = bare(s); return b.charAt(0).toLocaleUpperCase('pt-BR') + b.slice(1); };
const sentence = (s: string) => { const c = upper(s); return /[.!?]$/.test(c) ? c : `${c}.`; };
const bullets = (items: string[]) => items.map((i) => `• ${sentence(i)}`).join('\n');
const series = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}` : items[0] ?? '');
const confirmedStatuses = ['completed', 'partially_completed', 'in_progress'];
const normal = (s: string) => bare(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
/** Main clause of a nominalized activity, for compact mentions in running text. */
// Cuts at a comma or a word boundary, never inside a word, and not on a dangling preposition.
const cutAt = (text: string, max: number) => {
  if (text.length <= max) return text;
  const comma = text.lastIndexOf(', ', max), space = text.lastIndexOf(' ', max);
  return text.slice(0, comma > max * 0.5 ? comma : space > 0 ? space : max).replace(/\s+(de|da|do|das|dos|e|a|o|à|ao|em|na|no|com|para|sobre)$/i, '');
};
// The nouns plus the first piece of their object: "planejamento, organização e
// acompanhamento da execução orçamentária e financeira", without enumerations.
const short = (n: Nominal & { headLength?: number }, max = 130): Nominal => {
  const comma = n.headLength ? n.text.indexOf(', ', n.headLength) : -1;
  const core = comma > 25 ? n.text.slice(0, comma) : n.text.split(/,\s+(?=\S+(?:ando|endo|indo)\b|incluindo|considerando)/)[0];
  return { ...n, text: bare(cutAt(core, max)) };
};
const withArticle = (n: Nominal) => `${n.feminine ? 'a' : 'o'} ${lower(n.text)}`;

// Stable choice among phrasings, so each scholar and report reads differently
// while regenerating the same report keeps its wording.
function picker(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return <T,>(options: T[], salt: number) => options[Math.abs(h + salt * 2654435761) % options.length];
}

/**
 * Builds the Formulário 9 sections from the plan and the execution records of a
 * single scholar. The cronograma decides what was foreseen for the period; only
 * confirmed execution records are written as results. The scholar's name stays
 * in the heading and the signature, not in the text.
 */
export function generateReport(input: Input): { content: ReportContent; traceability: object } {
  const { periodStart: start, periodEnd: end } = input, mode = input.lengthMode ?? 'standard';
  const pick = picker(`${input.scholar.id ?? input.scholar.full_name}|${input.number}`);
  const objectives = input.planItems.filter((i) => i.item_type === 'objective');
  const general = objectives.find((i) => i.source_reference?.section === 'general');
  const specifics = objectives.filter((i) => i !== general);
  const activities = input.planItems.filter((i) => i.item_type === 'activity');
  const scheduled = activities.filter((a) => isScheduledIn(a, start, end));
  const anySchedule = activities.some(hasSchedule);
  const byPlan = new Map<string, any[]>();
  for (const e of input.executions) if (e.plan_item_id) byPlan.set(e.plan_item_id, [...(byPlan.get(e.plan_item_id) ?? []), e]);
  const done = input.executions.filter((e) => confirmedStatuses.includes(e.status) && (e.executed_activity || e.result || e.product));
  const pending = scheduled.filter((a) => !byPlan.has(a.id)).map((a) => ({ activity: bare(a.title), reason: 'Não foram localizadas informações suficientes para confirmar a execução desta atividade no período selecionado.' }));
  const pendingItems = scheduled.filter((a) => !byPlan.has(a.id));
  const focus: Nominal | null = general ? nominalize(mainClause(general.title)) : null;
  const period = `${fmt(start)} a ${fmt(end)}`;
  const role = bare(input.functionalIdentity || input.scholar.role_area || '');
  const cronoRef = pick(['em conformidade com o cronograma de atividades individualizado', 'conforme previsto no cronograma de atividades individualizado', 'de acordo com o cronograma de atividades individualizado'], 1);

  // A confirmed execution reads as the planned activity in nominal form when it
  // was confirmed as planned, or as written by whoever registered it.
  const resultLine = (e: any) => {
    const item = activities.find((a) => a.id === e.plan_item_id);
    const executed = e.executed_activity || e.planned_activity;
    const base = item && normal(executed) === normal(item.title) ? nominalize(item.title).text : bare(executed);
    return `${upper(base)}${e.result ? `, com o seguinte resultado registrado: ${lower(e.result)}` : ''}`;
  };

  // 1.1 Objetivos propostos no plano individual versus objetivos alcançados
  const opening = done.length && focus
    ? pick([
      `No período avaliado, de ${period}, as atividades desenvolvidas guardam relação com os objetivos estabelecidos no Plano de Trabalho do Bolsista, especialmente quanto ${toThe(focus)}.`,
      `Entre ${fmt(start)} e ${fmt(end)}, a atuação no projeto concentrou-se nas atribuições definidas no Plano de Trabalho do Bolsista, com ênfase ${inThe(focus)}.`,
      `O período de ${period} compreendeu atividades vinculadas aos objetivos do Plano de Trabalho do Bolsista, notadamente no que se refere ${toThe(focus)}.`
    ], 2)
    : `O presente relatório refere-se ao período de ${period} e toma como referência as atribuições estabelecidas no Plano de Trabalho do Bolsista${focus ? `, voltadas ${toThe(focus)}` : ''}.`;
  const roleText = role && mode !== 'concise' ? ` ${pick(['A atuação corresponde à função de', 'As atribuições correspondem à função de', 'O plano vincula essa atuação à função de'], 3)} ${lower(role)}.` : '';
  const objectiveText = !objectives.length ? 'O Plano de Trabalho não apresenta objetivos individuais suficientemente estruturados para este período, sendo necessária conferência documental.'
    : mode === 'detailed' && specifics.length ? `Os objetivos específicos previstos no Plano de Trabalho são:\n${bullets(specifics.map((o) => o.title))}`
    : mode === 'standard' && specifics.length ? `O Plano de Trabalho estabelece ${specifics.length} objetivos específicos, aos quais se vinculam as atividades descritas a seguir.` : '';

  const doneNominals = done.map((e) => { const item = activities.find((a) => a.id === e.plan_item_id); return short(nominalize(item?.title ?? e.executed_activity)); });
  const concentration = done.length
    ? `${pick(['As atividades concentraram-se', 'A execução concentrou-se', 'O trabalho do período concentrou-se'], 4)} ${series(doneNominals.slice(0, 4).map(inThe))}${doneNominals.length > 4 ? ', entre outras frentes previstas' : ''}, ${cronoRef}.`
    : '';
  const resultsList = done.length ? `${pick(['Os principais resultados parciais alcançados foram:', 'Destacam-se, no período, os seguintes resultados parciais:', 'Entre os resultados parciais registrados, destacam-se:'], 5)}\n${bullets(done.map(resultLine))}` : '';
  const scheduleText = done.length || !activities.length ? ''
    : scheduled.length ? `${anySchedule ? 'De acordo com o cronograma de atividades individualizado' : 'Conforme o Plano de Trabalho, que não detalha meses para estas atividades'}, estavam programadas para o período as seguintes atividades:\n${bullets(scheduled.map((a) => nominalize(a.title).text))}`
    : 'O cronograma de atividades individualizado não prevê atividades para o período informado.';
  const executionText = done.length ? '' : 'Até a emissão desta versão preliminar, não foram localizados registros suficientes para afirmar a execução das atividades programadas para o período, que permanecem pendentes de confirmação pelo responsável.';
  const pendingText = pendingItems.length && done.length ? `Permanecem pendentes de confirmação no período:\n${bullets(pendingItems.map((a) => nominalize(a.title).text))}` : '';
  const deviations = input.executions.filter((e) => ['rescheduled', 'delayed'].includes(e.status)).map((e) => `${e.planned_activity || e.executed_activity}${e.status === 'rescheduled' ? ' (reprogramada' : ' (em atraso'}${e.notes ? `: ${e.notes}` : ''})`);
  const closing11 = !done.length ? ''
    : !pendingItems.length && !deviations.length ? pick([
      'De forma geral, as atividades programadas para o período possuem execução confirmada, em consonância com as atribuições previstas no Plano de Trabalho do Bolsista.',
      'Em síntese, todas as atividades previstas no cronograma para o período contam com registro de execução, em correspondência com os objetivos do Plano de Trabalho do Bolsista.'
    ], 6)
    : 'As atividades com execução confirmada guardam correspondência com as atribuições do Plano de Trabalho; as demais permanecem em acompanhamento e deverão ser demonstradas nos registros dos períodos seguintes.';
  const results = [`${opening}${roleText}`, objectiveText, concentration, resultsList, scheduleText, executionText, pendingText, closing11].filter(Boolean).join('\n\n');

  // 1.2 Resultados esperados versus resultados obtidos (conforme cronograma estabelecido)
  const expected = input.planItems.filter((i) => ['product', 'goal'].includes(i.item_type) && isScheduledIn(i, start, end)).map((x) => x.title);
  const products = done.map((e) => e.product).filter(Boolean);
  const completed = done.filter((e) => e.status === 'completed').map((e) => e.planned_activity || e.executed_activity);
  const ongoing = done.filter((e) => e.status !== 'completed').map((e) => `${lower(e.planned_activity || e.executed_activity)}${e.status === 'partially_completed' ? ' (parcialmente concluída)' : ''}`);
  const intro12 = done.length ? pick([
    'Os resultados obtidos no período relacionam-se aos produtos previstos no Plano de Trabalho do Bolsista e ao cronograma estabelecido.',
    'Considerando o cronograma estabelecido, os resultados do período vinculam-se aos produtos e entregas previstos no Plano de Trabalho do Bolsista.',
    'A comparação entre o previsto e o obtido considera os produtos do Plano de Trabalho do Bolsista e as atividades programadas no cronograma para o período.'
  ], 7) : '';
  const completedCount = done.filter((e) => e.status === 'completed' && e.plan_item_id).length;
  const ongoingShort = done.filter((e) => e.status !== 'completed').map((e) => { const item = activities.find((a) => a.id === e.plan_item_id); return toThe(short(nominalize(item?.title ?? e.executed_activity), 90)); });
  const statusText = scheduled.length && done.length ? `Das ${scheduled.length} atividades programadas no cronograma para o período, ${completedCount === 1 ? 'uma consta como concluída' : `${completedCount} constam como concluídas`}${ongoingShort.length ? ` e ${ongoingShort.length === 1 ? 'uma permanece' : `${ongoingShort.length} permanecem`} em andamento, ${ongoingShort.length === 1 ? 'que corresponde' : 'que correspondem'} ${series(ongoingShort)}` : ''}${pendingItems.length ? `; ${pendingItems.length} ainda sem registro de execução` : ''}.` : '';
  const comparison = !expected.length && !done.length && !deviations.length
    ? 'Não há resultados esperados estruturados suficientes para estabelecer comparação conclusiva. Os registros do período devem ser complementados antes da aprovação.'
    : [
      intro12,
      products.length ? `No período, foram registrados como produtos:\n${bullets(products)}` : 'Não há produtos comprovados cadastrados para o período até a emissão desta versão.',
      expected.length ? (mode === 'concise' ? `O Plano de Trabalho prevê ${expected.length} produtos e entregas ao longo da vigência da bolsa.` : `Entre os produtos e entregas esperados no Plano de Trabalho, constam:\n${bullets(expected)}`) : '',
      [statusText || (completed.length ? `Foram registradas como concluídas: ${join(completed.map(lower))}.` : ''), !statusText && ongoing.length ? `Encontram-se em andamento: ${ongoing.join('; ')}.` : '', deviations.length ? `Registram-se os seguintes desvios em relação ao cronograma: ${join(deviations)}.` : ''].filter(Boolean).join(' '),
      ongoing.length || pending.length ? 'Por se tratar de relatório parcial, atividades em andamento ou ainda sem registro não representam, por si, descumprimento do Plano de Trabalho; sua evolução deverá ser demonstrada nos registros dos períodos seguintes.' : ''
    ].filter(Boolean).join('\n\n');

  // 2. Informações adicionais
  const focusShort = focus ? short(focus, 110) : null;
  const summary = done.length && focusShort ? pick([
    `Durante o período de referência, as atividades concentraram-se ${inThe(focusShort)}, em conformidade com as atribuições estabelecidas no Plano de Trabalho do Bolsista.`,
    `No período, a atuação manteve-se vinculada ${toThe(focusShort)}, conforme as atribuições do Plano de Trabalho do Bolsista.`,
    `Em síntese, o período foi marcado pela atuação voltada ${toThe(focusShort)}, nos termos do Plano de Trabalho do Bolsista.`
  ], 8) : '';
  const extras = done.flatMap((e) => [e.difficulties && `Dificuldade registrada: ${sentence(e.difficulties)}`, e.actions_taken && `Providência adotada: ${sentence(e.actions_taken)}`]).filter(Boolean);
  const unlinked = done.filter((e) => !e.plan_item_id).map((e) => e.executed_activity);
  const nextMonths = monthsBetween(`${addMonths(toMonth(end), 1)}-01`, `${addMonths(toMonth(end), 3)}-01`);
  const upcoming = mode === 'concise' ? [] : activities.filter((a) => a.scheduled_months?.some((m: string) => nextMonths.includes(m)));
  const upcomingNames = upcoming.map((a) => withArticle(short(nominalize(a.title), 90)));
  const additional = [
    summary,
    extras.join(' '),
    unlinked.length ? `Registram-se ainda atividades realizadas no período sem vínculo direto com itens do Plano de Trabalho: ${join(unlinked.map(lower))}.` : '',
    upcoming.length ? `Para o período subsequente (${describeMonths(nextMonths)}), o cronograma individualizado prevê a continuidade de ${upcoming.length === 1 ? 'uma atividade' : `${upcoming.length} atividades`}${mode === 'detailed' ? `: ${join(upcomingNames)}` : `, entre elas ${series(upcomingNames.slice(0, 3))}`}.` : ''
  ].filter(Boolean).join('\n\n');

  const content: ReportContent = {
    heading: { foundation: input.project.support_foundation, form: 'FORMULÁRIO 9', title: 'RELATÓRIO TÉCNICO PARCIAL (RTP)', project: input.project.title, scholar: input.scholar.full_name, scholarshipPeriod: `${monthYear(input.scholar.starts_on)} a ${monthYear(input.scholar.ends_on)}`, number: input.number },
    sections: { results, comparison, additional: additional || 'Não foram registradas informações complementares relevantes para o período.' },
    closing: { placeAndDate: `${input.project.city}, ${longDate(input.issuedOn)}`, scholar: input.scholar.full_name, role: 'Bolsista' }, pending
  };
  return { content, traceability: { objectives: objectives.map((x) => x.id), scheduledActivities: scheduled.map((x) => x.id), executions: done.map((x) => x.id), pending: pending.map((x) => x.activity), upcoming: upcoming.map((x) => x.id) } };
}

export function validateReport(content: ReportContent, input: Input) {
  const findings: Array<{ severity: string; code: string; message: string; location: string; source_reference: object }> = [];
  if (input.planStatus && input.planStatus !== 'confirmed') findings.push({ severity: 'attention', code: 'PLAN_NOT_CONFIRMED', message: 'O Plano de Trabalho ainda não foi conferido e confirmado por um responsável.', location: 'Plano de Trabalho', source_reference: { planStatus: input.planStatus } });
  if (!input.planItems.some((x) => x.item_type === 'objective')) findings.push({ severity: 'attention', code: 'NO_OBJECTIVES', message: 'Objetivos individuais não foram confirmados no plano.', location: 'Seção 1.1', source_reference: {} });
  const unscheduled = input.planItems.filter((x) => x.item_type === 'activity' && !hasSchedule(x));
  if (unscheduled.length) findings.push({ severity: 'attention', code: 'ACTIVITY_WITHOUT_SCHEDULE', message: `${unscheduled.length} atividade(s) do plano sem meses no cronograma; foram tratadas como previstas para qualquer período.`, location: 'Cronograma', source_reference: { activities: unscheduled.map((x) => x.id) } });
  content.pending.forEach((p) => findings.push({ severity: 'attention', code: 'UNCONFIRMED_ACTIVITY', message: p.reason, location: 'Seção 1.1', source_reference: { activity: p.activity } }));
  for (const e of input.executions) {
    if (e.execution_start && (e.execution_start < input.periodStart || e.execution_start > input.periodEnd)) findings.push({ severity: 'critical', code: 'OUTSIDE_PERIOD', message: 'Registro de execução fora do período do RTP.', location: 'Seção 1.1', source_reference: { executionId: e.id } });
    const item = input.planItems.find((i) => i.id === e.plan_item_id);
    if (item?.scheduled_months?.length && !isScheduledIn(item, e.period_start, e.period_end)) findings.push({ severity: 'attention', code: 'OUTSIDE_SCHEDULE', message: `Execução registrada fora dos meses previstos no cronograma para "${bare(item.title).slice(0, 80)}".`, location: 'Seção 1.2', source_reference: { executionId: e.id, planItemId: item.id } });
  }
  if (!input.executions.some((e) => e.result || e.product)) findings.push({ severity: 'attention', code: 'NO_EVIDENCED_RESULTS', message: 'Nenhum resultado ou produto foi confirmado para o período.', location: 'Seções 1.1 e 1.2', source_reference: {} });
  return findings;
}
