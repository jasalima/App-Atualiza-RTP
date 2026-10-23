import { addMonths, describeMonths, hasSchedule, isScheduledIn, monthsBetween, toMonth } from '../../lib/schedule';
import type { ReportContent } from '../types.js';

type LengthMode = 'concise' | 'standard' | 'detailed';
type Input = { project: any; scholar: any; planItems: any[]; executions: any[]; number: string; periodStart: string; periodEnd: string; issuedOn: string; planStatus?: string; functionalIdentity?: string; lengthMode?: LengthMode };
const fmt = (date: string | Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${String(date instanceof Date ? date.toISOString() : date).slice(0, 10)}T12:00:00Z`));
const join = (values: string[]) => values.filter(Boolean).join('; ');
const bare = (s: string) => String(s ?? '').trim().replace(/[\s;.:,]+$/, '');
const lower = (s: string) => { const b = bare(s); return /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]/.test(b) ? b[0].toLocaleLowerCase('pt-BR') + b.slice(1) : b; };
const list = (items: string[]) => join(items.map(lower));
const sentence = (s: string) => { const t = s.trim(), c = t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1); return /[.!?]$/.test(c) ? c : `${c}.`; };
const confirmedStatuses = ['completed', 'partially_completed', 'in_progress'];

/**
 * Builds the Formulário 9 sections from the plan and the execution records of a
 * single scholar. The cronograma decides what was foreseen for the period;
 * only execution records state what happened. Nothing planned is written as done.
 */
export function generateReport(input: Input): { content: ReportContent; traceability: object } {
  const { periodStart: start, periodEnd: end } = input, mode = input.lengthMode ?? 'standard';
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

  // 1.1 Objetivos propostos versus objetivos alcançados
  const role = bare(input.functionalIdentity || input.scholar.role_area || '');
  const opening = `O presente relatório abrange o período de ${fmt(start)} a ${fmt(end)} e tem como referência o Plano de Trabalho individual de ${input.scholar.full_name}${role ? `, cuja atuação no projeto compreende ${lower(role)}` : ''}.`
    + (general && mode !== 'concise' ? ` O objetivo geral estabelecido para a bolsa consiste em ${lower(general.title)}.` : '');
  const objectiveText = !objectives.length ? 'O Plano de Trabalho não apresenta objetivos individuais suficientemente estruturados para este período, sendo necessária conferência documental.'
    : specifics.length && mode !== 'concise' ? `Os objetivos específicos previstos são: ${list(specifics.map((o) => o.title))}.` : '';
  const scheduleText = !activities.length ? ''
    : scheduled.length ? `${anySchedule ? 'De acordo com o cronograma de atividades individualizado' : 'Conforme o Plano de Trabalho, que não detalha meses para estas atividades'}, estavam programadas para o período ${scheduled.length === 1 ? 'a seguinte atividade' : `as seguintes ${scheduled.length} atividades`}: ${list(scheduled.map((a) => a.title))}.`
    : 'O cronograma de atividades individualizado não prevê atividades para o período informado.';
  const executionText = done.length
    ? `Os registros de execução referentes ao período informam: ${join(done.map((x) => `${bare(x.executed_activity || x.planned_activity)}${x.result ? ` (resultado registrado: ${lower(x.result)})` : ''}`))}. Essas informações refletem exclusivamente os registros inseridos e as evidências vinculadas ao período.`
    : 'Até a emissão desta versão preliminar, não foram localizados registros suficientes para afirmar a execução das atividades programadas para o período.';
  const pendingText = pending.length && done.length ? `Não foram localizadas informações suficientes para confirmar, no período, a execução de: ${list(pending.map((p) => p.activity))}. Essas atividades permanecem pendentes de confirmação pelo responsável.` : '';
  const results = [opening, objectiveText, scheduleText, executionText, pendingText].filter(Boolean).join('\n\n');

  // 1.2 Resultados esperados versus resultados obtidos
  const expected = input.planItems.filter((i) => ['product', 'goal'].includes(i.item_type) && isScheduledIn(i, start, end)).map((x) => x.title);
  const products = done.map((e) => e.product).filter(Boolean);
  // Status lists name the planned activity; what was actually done is already quoted in 1.1.
  const completed = done.filter((e) => e.status === 'completed').map((e) => e.planned_activity || e.executed_activity);
  const ongoing = done.filter((e) => e.status !== 'completed').map((e) => `${lower(e.planned_activity || e.executed_activity)}${e.status === 'partially_completed' ? ' (parcialmente concluída)' : ''}`);
  const deviations = input.executions.filter((e) => ['rescheduled', 'delayed'].includes(e.status)).map((e) => `${e.planned_activity || e.executed_activity}${e.status === 'rescheduled' ? ' (reprogramada' : ' (em atraso'}${e.notes ? `: ${e.notes}` : ''})`);
  const comparison = !expected.length && !done.length && !deviations.length
    ? 'Não há resultados esperados estruturados suficientes para estabelecer comparação conclusiva. Os registros do período devem ser complementados antes da aprovação.'
    : [
      expected.length ? (mode === 'concise' ? `O Plano de Trabalho prevê ${expected.length} produtos e entregas ao longo da vigência da bolsa.` : `Entre os produtos e entregas esperados no Plano de Trabalho, constam: ${list(expected)}.`) : '',
      products.length ? `No período, foram registrados como produtos: ${list(products)}.` : 'Não há produtos comprovados cadastrados para o período até a emissão desta versão.',
      completed.length ? `Foram registradas como concluídas: ${list(completed)}.` : '',
      ongoing.length ? `Encontram-se em andamento: ${ongoing.join('; ')}.` : '',
      deviations.length ? `Registram-se os seguintes desvios em relação ao cronograma: ${join(deviations)}.` : '',
      ongoing.length || pending.length ? 'Por se tratar de relatório parcial, atividades em andamento ou ainda sem registro não representam, por si, descumprimento do Plano de Trabalho; sua evolução deverá ser demonstrada nos registros dos períodos seguintes.' : ''
    ].filter(Boolean).join(' ');

  // 2. Informações adicionais
  const extras = done.flatMap((e) => [e.difficulties && `Dificuldade registrada: ${sentence(e.difficulties)}`, e.actions_taken && `Providência adotada: ${sentence(e.actions_taken)}`]).filter(Boolean);
  const unlinked = done.filter((e) => !e.plan_item_id).map((e) => e.executed_activity);
  const nextMonths = monthsBetween(`${addMonths(toMonth(end), 1)}-01`, `${addMonths(toMonth(end), 3)}-01`);
  const upcoming = mode === 'concise' ? [] : activities.filter((a) => a.scheduled_months?.some((m: string) => nextMonths.includes(m)));
  const additional = [
    extras.join(' '),
    unlinked.length ? `Registram-se ainda atividades realizadas no período sem vínculo direto com itens do Plano de Trabalho: ${list(unlinked)}.` : '',
    upcoming.length ? `Para o período subsequente (${describeMonths(nextMonths)}), o cronograma individualizado prevê a continuidade de ${upcoming.length === 1 ? 'uma atividade' : `${upcoming.length} atividades`}${mode === 'detailed' ? `: ${list(upcoming.map((a) => a.title))}` : ''}.` : ''
  ].filter(Boolean).join('\n\n');

  const content: ReportContent = {
    heading: { foundation: input.project.support_foundation, form: 'FORMULÁRIO 9', title: 'RELATÓRIO TÉCNICO PARCIAL (RTP)', project: input.project.title, scholar: input.scholar.full_name, scholarshipPeriod: `${fmt(input.scholar.starts_on)} a ${fmt(input.scholar.ends_on)}`, number: input.number },
    sections: { results, comparison, additional: additional || 'Não foram registradas informações complementares relevantes para o período.' },
    closing: { placeAndDate: `${input.project.city}, ${fmt(input.issuedOn)}`, scholar: input.scholar.full_name, role: 'Bolsista' }, pending
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
