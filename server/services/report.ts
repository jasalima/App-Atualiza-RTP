import type { ReportContent } from '../types.js';

type Input = { project: any; scholar: any; planItems: any[]; executions: any[]; number: string; periodStart: string; periodEnd: string; issuedOn: string };
const fmt = (date: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const join = (values: string[]) => values.filter(Boolean).join('; ');

export function generateReport(input: Input): { content: ReportContent; traceability: object } {
  const relevant = input.planItems.filter((i) => (!i.starts_on || i.starts_on <= input.periodEnd) && (!i.ends_on || i.ends_on >= input.periodStart));
  const objectives = relevant.filter((i) => i.item_type === 'objective');
  const activities = relevant.filter((i) => i.item_type === 'activity');
  const byPlan = new Map(input.executions.map((e) => [e.plan_item_id, e]));
  const done = input.executions.filter((e) => ['completed', 'partially_completed', 'in_progress'].includes(e.status) && (e.executed_activity || e.result || e.product));
  const pending = activities.filter((a) => !byPlan.has(a.id)).map((a) => ({ activity: a.title, reason: 'Não foram localizadas informações suficientes para confirmar a execução desta atividade no período selecionado.' }));
  const objectiveText = objectives.length ? `No período de ${fmt(input.periodStart)} a ${fmt(input.periodEnd)}, o acompanhamento considerou os objetivos individuais estabelecidos no Plano de Trabalho: ${join(objectives.map((x) => x.title))}.` : 'O Plano de Trabalho não apresenta objetivos individuais suficientemente estruturados para este período, sendo necessária conferência documental.';
  const executionText = done.length ? `Os registros de execução confirmam: ${join(done.map((x) => `${x.executed_activity || x.planned_activity}${x.result ? `, com o resultado registrado de ${x.result}` : ''}`))}. Essas informações refletem exclusivamente os registros inseridos e as evidências vinculadas ao período.` : 'Até a emissão desta versão preliminar, não foram localizados registros suficientes para afirmar a execução das atividades planejadas.';
  const expected = relevant.filter((i) => ['product', 'goal'].includes(i.item_type)).map((x) => x.title);
  const products = done.map((e) => e.product).filter(Boolean);
  const comparison = expected.length ? `Foram previstos para o ciclo os seguintes resultados ou produtos: ${join(expected)}. ${products.length ? `Constam como produtos registrados: ${join(products)}.` : 'Não há produtos comprovados cadastrados até o momento.'} As atividades em andamento ou sem evidência permanecem sujeitas a complementação e validação humana.` : 'Não há resultados esperados estruturados suficientes para estabelecer comparação conclusiva. Os registros do período devem ser complementados antes da aprovação.';
  const extras = done.flatMap((e) => [e.difficulties && `Dificuldade registrada: ${e.difficulties}.`, e.actions_taken && `Providência adotada: ${e.actions_taken}.`]).filter(Boolean);
  const content: ReportContent = {
    heading: { foundation: input.project.support_foundation, form: 'FORMULÁRIO 9', title: 'RELATÓRIO TÉCNICO PARCIAL (RTP)', project: input.project.title, scholar: input.scholar.full_name, scholarshipPeriod: `${fmt(input.scholar.starts_on)} a ${fmt(input.scholar.ends_on)}`, number: input.number },
    sections: { results: `${objectiveText}\n\n${executionText}`, comparison, additional: extras.length ? extras.join(' ') : 'Não foram registradas informações complementares relevantes para o período.' },
    closing: { placeAndDate: `${input.project.city}, ${fmt(input.issuedOn)}`, scholar: input.scholar.full_name, role: 'Bolsista' }, pending
  };
  return { content, traceability: { objectives: objectives.map((x) => x.id), activities: activities.map((x) => x.id), executions: done.map((x) => x.id), pending: pending.map((x) => x.activity) } };
}

export function validateReport(content: ReportContent, input: Input) {
  const findings: Array<{ severity: string; code: string; message: string; location: string; source_reference: object }> = [];
  if (!input.planItems.some((x) => x.item_type === 'objective')) findings.push({ severity: 'attention', code: 'NO_OBJECTIVES', message: 'Objetivos individuais não foram confirmados no plano.', location: 'Seção 1.1', source_reference: {} });
  content.pending.forEach((p) => findings.push({ severity: 'attention', code: 'UNCONFIRMED_ACTIVITY', message: p.reason, location: 'Seção 1.2', source_reference: { activity: p.activity } }));
  for (const e of input.executions) if (e.execution_start && (e.execution_start < input.periodStart || e.execution_start > input.periodEnd)) findings.push({ severity: 'critical', code: 'OUTSIDE_PERIOD', message: 'Registro de execução fora do período do RTP.', location: 'Seção 1.1', source_reference: { executionId: e.id } });
  if (!input.executions.some((e) => e.result || e.product)) findings.push({ severity: 'attention', code: 'NO_EVIDENCED_RESULTS', message: 'Nenhum resultado ou produto foi confirmado para o período.', location: 'Seções 1.1 e 1.2', source_reference: {} });
  return findings;
}
