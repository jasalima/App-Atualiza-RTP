import { addMonths, describeMonths, hasSchedule, isScheduledIn, monthNames, monthsBetween, toMonth } from '../../lib/schedule';
import { inThe, mainClause, nominalize, toThe } from '../../lib/nominalize';
import type { ReportContent } from '../types.js';

type LengthMode = 'concise' | 'standard' | 'detailed';
type PreviousReport = { number: string; period_start: string; period_end: string };
type Input = { project: any; scholar: any; planItems: any[]; executions: any[]; number: string; periodStart: string; periodEnd: string; issuedOn: string; planStatus?: string; functionalIdentity?: string; lengthMode?: LengthMode; previousReports?: PreviousReport[] };
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
const ordinals = ['primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'sétimo', 'oitavo', 'nono', 'décimo'];
// Cuts at a comma or a word boundary, never inside a word, and not on a dangling preposition.
const cutAt = (text: string, max: number) => {
  if (text.length <= max) return text;
  const comma = text.lastIndexOf(', ', max), space = text.lastIndexOf(' ', max);
  let cut = text.slice(0, comma > max * 0.5 ? comma : space > 0 ? space : max);
  // Drop dangling words repeatedly: "relevantes para a" → "relevantes".
  while (/\s+(de|da|do|das|dos|e|a|o|as|os|à|ao|às|aos|em|na|no|nas|nos|com|para|sobre|pela|pelo)$/i.test(cut)) cut = cut.replace(/\s+\S+$/, '');
  return cut;
};
// The nouns plus the first piece of their object: "planejamento, organização e
// acompanhamento da execução orçamentária e financeira", without enumerations.
const short = (n: Nominal, max = 130): Nominal => {
  const comma = n.headLength ? n.text.indexOf(', ', n.headLength) : -1;
  const core = comma > 25 ? n.text.slice(0, comma) : n.text.split(/,\s+(?=\S+(?:ando|endo|indo)\b|incluindo|considerando)/)[0];
  return { ...n, text: bare(cutAt(core, max)) };
};
const withArticle = (n: Nominal) => `${n.feminine ? 'a' : 'o'} ${lower(n.text)}`;
/** "do planejamento…" / "da gestão…" */
const ofN = (n: Nominal) => `${n.feminine ? 'da' : 'do'} ${lower(n.text)}`;
const feminineNoun = (word: string) => /(ção|são|dade|gem|ise|ncia|tura)$/i.test(word);

// Parties named in the plan's own wording; mentioned only when the plan cites them.
const partners: Array<[RegExp, string]> = [
  [/coordena[cç][aã]o geral/i, 'a Coordenação Geral'], [/equipes? t[eé]cnicas?/i, 'as equipes técnicas'],
  [/funda[cç][aã]o de apoio/i, 'a Fundação de Apoio'], [/[oó]rg[aã]os p[uú]blicos/i, 'órgãos públicos'],
  [/institui[cç][oõ]es parceiras/i, 'instituições parceiras'], [/especialistas/i, 'especialistas'],
  [/equipes administrativas|administrativas e de governan[cç]a/i, 'as equipes administrativas e de governança']
];

// Independent, stable choice per paragraph: the same scholar, number and attempt
// always yield the same wording; another attempt reshuffles every paragraph.
function picker(seed: string) {
  return <T,>(options: T[], salt: number) => {
    let h = 2166136261;
    for (const c of `${seed}#${salt}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return options[(h >>> 0) % options.length];
  };
}

/**
 * Builds the Formulário 9 sections from the plan and the execution records of a
 * single scholar. Activities scheduled in the cronograma for the period are
 * reported as executed unless a record says otherwise; records' own words and
 * results prevail. The scholar's name stays in the heading and the signature.
 */
export function generateReport(input: Input, attempt = 0): { content: ReportContent; traceability: object } {
  const { periodStart: start, periodEnd: end } = input, mode = input.lengthMode ?? 'standard';
  const pick = picker(`${input.scholar.id ?? input.scholar.full_name}|${input.number}|${attempt}`);
  const objectives = input.planItems.filter((i) => i.item_type === 'objective');
  const general = objectives.find((i) => i.source_reference?.section === 'general');
  const specifics = objectives.filter((i) => i !== general);
  const activities = input.planItems.filter((i) => i.item_type === 'activity');
  const scheduled = activities.filter((a) => isScheduledIn(a, start, end));
  const anySchedule = activities.some(hasSchedule);
  const records = (a: any) => input.executions.filter((e) => e.plan_item_id === a.id);
  const done = input.executions.filter((e) => confirmedStatuses.includes(e.status) && (e.executed_activity || e.result || e.product));
  const notExecuted = new Set(['rescheduled', 'delayed', 'not_applicable']);
  const executed = scheduled.filter((a) => !records(a).some((e) => notExecuted.has(e.status)));
  const assumed = executed.filter((a) => !records(a).some((e) => confirmedStatuses.includes(e.status)));
  const unlinked = done.filter((e) => !e.plan_item_id);
  const focus: Nominal | null = general ? nominalize(mainClause(general.title)) : null;
  const focusShort = focus ? short(focus, 110) : null;
  const period = `${fmt(start)} a ${fmt(end)}`;
  const role = bare(input.functionalIdentity || input.scholar.role_area || '');
  const hasWork = executed.length > 0 || unlinked.length > 0;

  // Where the period sits in the scholarship, and how it follows earlier reports.
  const previous = [...(input.previousReports ?? [])].sort((a, b) => iso(b.period_end).localeCompare(iso(a.period_end)));
  const prev = previous[0];
  const ordinal = ordinals[previous.length] ?? `${previous.length + 1}º`;
  const elapsed = input.scholar.starts_on ? monthsBetween(iso(input.scholar.starts_on), end).length : 0;
  const total = input.scholar.starts_on && input.scholar.ends_on ? monthsBetween(iso(input.scholar.starts_on), iso(input.scholar.ends_on)).length : 0;
  const lastPeriod = !!input.scholar.ends_on && toMonth(end) >= toMonth(iso(input.scholar.ends_on));
  const elapsedText = elapsed && total ? (elapsed === 1 ? 'o primeiro mês de vigência da bolsa' : `${elapsed} dos ${total} meses de vigência da bolsa`) : '';
  const workText = [...executed.map((a) => a.title), ...unlinked.map((e) => e.executed_activity), general?.title ?? ''].join(' ');
  const partnerNames = partners.filter(([re]) => re.test(workText)).map(([, name]) => name);
  const projectWord = bare(input.project.title ?? '').split(' ')[0] ?? '';
  const projectRef = input.project.title ? `${feminineNoun(projectWord) ? 'a' : 'o'} ${lower(input.project.title)}` : '';

  const executedLine = (a: any) => {
    const record = records(a).find((e) => confirmedStatuses.includes(e.status));
    const own = record?.executed_activity && normal(record.executed_activity) !== normal(a.title) ? bare(record.executed_activity) : nominalize(a.title).text;
    return `${upper(own)}${record?.result ? `, com o seguinte resultado: ${lower(record.result)}` : ''}`;
  };
  const unlinkedLine = (e: any) => `${upper(e.executed_activity)}${e.result ? `, com o seguinte resultado: ${lower(e.result)}` : ''}`;

  // 1.1 — opening: period framing, link to the objectives, role.
  // Anchors of this scholar, used so that no stock sentence is shared between members:
  // the function (or the core of the general objective), first/last executed activity, first product.
  // Without a function, the framing is anchored on the first executed activity (the
  // next sentence already names the focus), so it still differs between members.
  const scope = role ? `da função de ${lower(role)}` : executed[0] ? `relacionadas ${toThe(short(nominalize(executed[0].title), 55))} e às demais atribuições do plano` : 'previstas no Plano de Trabalho do Bolsista';
  const framing = pick([
    `O presente relatório refere-se às atividades ${scope} no período de ${period}${prev ? `, em continuidade ao RTP ${prev.number}, que abrangeu o intervalo de ${fmt(prev.period_start)} a ${fmt(prev.period_end)}` : elapsedText ? `, que compreende ${elapsedText}` : ''}.`,
    `Este ${ordinal} Relatório Técnico Parcial abrange as atividades ${scope} realizadas de ${fmt(start)} a ${fmt(end)}${elapsedText ? `, alcançando ${elapsedText}` : ''}.`,
    `O período de ${fmt(start)} a ${fmt(end)}${elapsedText ? `, que corresponde a ${elapsedText},` : ''} constitui o objeto deste ${ordinal} relatório parcial sobre as atividades ${scope}${prev ? `, em sequência ao RTP ${prev.number}` : ''}.`,
    `Entre ${fmt(start)} e ${fmt(end)}${prev ? `, dando continuidade ao relatado no RTP ${prev.number}` : ''}, foram desenvolvidas as atividades ${scope} descritas neste relatório${elapsedText ? `, período que totaliza ${elapsedText}` : ''}.`,
    `Este relatório${prev ? `, sucessor do RTP ${prev.number},` : ''} registra a execução das atividades ${scope} no período de ${period}${elapsedText ? `, abrangendo ${elapsedText}` : ''}.`
  ], 1);
  const link = !focus ? '' : hasWork ? pick([
    `As atividades desenvolvidas encontram-se em consonância com os objetivos estabelecidos no Plano de Trabalho do Bolsista, especialmente quanto ${toThe(focus)}.`,
    `A atuação esteve orientada pelas atribuições definidas no Plano de Trabalho do Bolsista, com ênfase ${inThe(focus)}.`,
    `O trabalho realizado vinculou-se diretamente aos objetivos do Plano de Trabalho do Bolsista, notadamente no que se refere ${toThe(focus)}.`,
    `As ações empreendidas guardam relação direta com o objetivo geral do Plano de Trabalho do Bolsista, voltado ${toThe(focus)}.`,
    `Nesse intervalo, os esforços concentraram-se ${inThe(focus)}, conforme estabelecido no Plano de Trabalho do Bolsista.`
  ], 2) : `O Plano de Trabalho do Bolsista tem como objetivo geral ${withArticle(focus)}.`;
  const roleText = role && mode !== 'concise' ? `${pick(['A atuação corresponde à função de', 'As atribuições correspondem à função de', 'O plano vincula essa atuação à função de', 'Essa atuação se dá na função de'], 3)} ${lower(role)}.` : '';
  const opening = [framing, link, roleText].filter(Boolean).join(' ');

  // Every template sentence carries something of this scholar (function or focus,
  // first specific objective), so stock phrasing never repeats across members.
  // Without a function, a compact label from the core of the general objective.
  const theme = role ? `da função de ${lower(role)}` : focus ? ofN(short(focus, 45)) : 'do Plano de Trabalho do Bolsista';
  const firstObjective = specifics[0] ? withArticle(short(nominalize(specifics[0].title), 80)) : '';
  const objectiveText = !objectives.length ? 'O Plano de Trabalho não apresenta objetivos individuais suficientemente estruturados para este período, sendo necessária conferência documental.'
    : mode === 'detailed' && specifics.length ? `Os objetivos específicos previstos no Plano de Trabalho são:\n${bullets(specifics.map((o) => o.title))}`
    : mode === 'standard' && specifics.length ? pick([
      `O Plano de Trabalho estabelece ${specifics.length} objetivos específicos, entre os quais ${firstObjective}, aos quais se vinculam as atividades descritas a seguir.`,
      `As atividades relatadas a seguir vinculam-se aos ${specifics.length} objetivos específicos estabelecidos no Plano de Trabalho, a começar por ${firstObjective}.`,
      `Os ${specifics.length} objetivos específicos do Plano de Trabalho, como ${firstObjective}, orientaram as atividades executadas no período, descritas a seguir.`
    ], 4) : '';
  const workNominals = [...executed.map((a) => short(nominalize(a.title))), ...unlinked.map((e) => short(nominalize(e.executed_activity)))];
  // Compact anchors (first and last executed activity) for closing sentences.
  const firstWork = workNominals[0] ? short(workNominals[0], 75) : null, lastWork = workNominals.length ? short(workNominals[workNominals.length - 1], 75) : null;
  const cronoRef = pick(['em conformidade com o cronograma de atividades individualizado', 'conforme previsto no cronograma de atividades individualizado', 'de acordo com o cronograma de atividades individualizado', 'segundo o cronograma de atividades individualizado'], 5);
  const concentration = workNominals.length
    ? `${pick(['As atividades concentraram-se', 'A execução concentrou-se', 'O trabalho do período concentrou-se', 'As ações do período concentraram-se'], 6)} ${series(workNominals.slice(0, 4).map(inThe))}${workNominals.length > 4 ? ', entre outras frentes previstas' : ''}, ${cronoRef}.`
    : '';
  const lead = anySchedule
    ? pick(['De acordo com o cronograma de atividades individualizado, as atividades executadas no período foram as seguintes:', 'Conforme o cronograma de atividades individualizado, foram executadas no período as seguintes atividades:', 'Em conformidade com o cronograma de atividades individualizado, as atividades executadas no período foram:', 'Segundo o cronograma de atividades individualizado, foram executadas no período:'], 7)
    : 'Conforme o Plano de Trabalho, as atividades executadas no período foram as seguintes:';
  const executedList = hasWork ? `${lead}\n${bullets([...executed.map(executedLine), ...unlinked.map(unlinkedLine)])}` : '';
  const scheduleText = !hasWork && activities.length ? 'O cronograma de atividades individualizado não prevê atividades para o período informado.' : '';
  const closing11 = hasWork ? pick([
    `De forma geral, as atividades programadas para o período, a exemplo ${ofN(firstWork!)}, foram executadas em consonância com os objetivos do Plano de Trabalho do Bolsista.`,
    `Em síntese, as atividades previstas no cronograma para o período foram executadas, ${ofN(firstWork!)} ${toThe(lastWork!)}, em correspondência com os objetivos do plano.`,
    `Assim, as atividades do período foram cumpridas conforme o cronograma, incluindo ${withArticle(lastWork!)}, em alinhamento com as responsabilidades ${theme}.`,
    `O conjunto das atividades executadas, que tem ${withArticle(firstWork!)} entre suas frentes, atende ao que o cronograma estabeleceu para o período.`
  ], 8) : '';
  const results = [opening, objectiveText, concentration, executedList, scheduleText, closing11].filter(Boolean).join('\n\n');

  // 1.2 Resultados esperados versus resultados obtidos (conforme cronograma estabelecido)
  const expected = input.planItems.filter((i) => ['product', 'goal'].includes(i.item_type) && isScheduledIn(i, start, end)).map((x) => x.title);
  const products = done.map((e) => e.product).filter(Boolean);
  const ongoing = done.filter((e) => e.status !== 'completed' && e.plan_item_id).map((e) => { const item = activities.find((a) => a.id === e.plan_item_id); return withArticle(short(nominalize(item?.title ?? e.executed_activity), 90)); });
  const deviations = input.executions.filter((e) => ['rescheduled', 'delayed'].includes(e.status)).map((e) => `${e.planned_activity || e.executed_activity}${e.status === 'rescheduled' ? ' (reprogramada' : ' (em atraso'}${e.notes ? `: ${e.notes}` : ''})`);
  const nextMonths = monthsBetween(`${addMonths(toMonth(end), 1)}-01`, `${addMonths(toMonth(end), 3)}-01`);
  const continuing = lastPeriod ? [] : activities.filter((a) => a.scheduled_months?.some((m: string) => nextMonths.includes(m)));
  const intro12 = hasWork ? pick([
    `Os resultados obtidos no período encontram-se compatíveis com os produtos previstos no Plano de Trabalho do Bolsista e com o cronograma estabelecido${focusShort ? `, especialmente quanto ${toThe(focusShort)}` : ''}.`,
    `Considerando o cronograma estabelecido, os resultados do período vinculam-se aos produtos e entregas previstos no Plano de Trabalho do Bolsista${focusShort ? `, com destaque ${toThe(focusShort)}` : ''}.`,
    `As atividades executadas no período, no âmbito ${theme}, produziram resultados compatíveis com os produtos previstos no Plano de Trabalho do Bolsista e com o cronograma estabelecido.`,
    `Em relação ao previsto no cronograma, os resultados do período correspondem às entregas planejadas para a função${focusShort ? `, em especial ${toThe(focusShort)}` : ''}.`
  ], 9) : '';
  const contributionLead = pick(['As atividades executadas no período contribuíram para os seguintes produtos e entregas previstos no Plano de Trabalho:', 'Os resultados do período concorrem para os seguintes produtos e entregas do Plano de Trabalho:', 'O trabalho realizado contribuiu para a construção dos seguintes produtos previstos no Plano de Trabalho:'], 10);
  const comparison = !expected.length && !hasWork && !deviations.length
    ? 'O Plano de Trabalho não apresenta produtos estruturados para comparação neste período.'
    : [
      intro12,
      products.length ? `No período, foram obtidos os seguintes produtos:\n${bullets(products)}` : '',
      expected.length && hasWork ? (mode === 'concise' ? `As atividades executadas contribuíram para os ${expected.length} produtos e entregas previstos no Plano de Trabalho.` : `${contributionLead}\n${bullets(expected)}`) : '',
      [ongoing.length ? `Encontram-se em execução, com continuidade prevista no cronograma, ${series(ongoing)}.` : '', deviations.length ? `Registram-se os seguintes desvios em relação ao cronograma: ${join(deviations)}.` : ''].filter(Boolean).join(' '),
      hasWork && continuing.length ? pick([`As atividades de caráter contínuo ${theme} prosseguirão nos períodos seguintes, conforme o cronograma estabelecido.`, `Por sua natureza contínua, as atividades ${theme} seguem previstas para os próximos períodos do cronograma.`, `A continuidade das atividades ${theme} está assegurada pelo cronograma nos meses subsequentes.`], 11) : ''
    ].filter(Boolean).join('\n\n');

  // 2. Informações adicionais — synthesis, interlocution, difficulties, contribution
  // to the project's final product, the next period and a closing remark.
  const summary = hasWork && focusShort ? pick([
    `Durante o período de referência, as atividades concentraram-se ${inThe(focusShort)}, em conformidade com as atribuições estabelecidas no Plano de Trabalho do Bolsista.`,
    `No período, a atuação manteve-se vinculada ${toThe(focusShort)}, conforme as atribuições do Plano de Trabalho do Bolsista.`,
    `Em síntese, o período foi marcado pela atuação voltada ${toThe(focusShort)}, nos termos do Plano de Trabalho do Bolsista.`,
    `Como aspecto central do período, destaca-se a atuação dedicada ${toThe(focusShort)}, em observância ao Plano de Trabalho do Bolsista.`,
    `A síntese do período evidencia a dedicação ${toThe(focusShort)}, de acordo com as atribuições previstas no Plano de Trabalho do Bolsista.`
  ], 12) : '';
  const interlocution = hasWork && partnerNames.length ? pick([
    `No desenvolvimento ${ofN(lastWork!)}, a atuação envolveu interlocução com ${series(partnerNames)}, conforme previsto no Plano de Trabalho.`,
    `As atividades ${theme} demandaram, no período, articulação com ${series(partnerNames)}, em consonância com as atribuições estabelecidas.`,
    `Destaca-se, ao longo do período, a interlocução mantida com ${series(partnerNames)}, inerente às atividades ${theme}.`
  ], 13) : '';
  const extras = done.flatMap((e) => [e.difficulties && `Dificuldade registrada: ${sentence(e.difficulties)}`, e.actions_taken && `Providência adotada: ${sentence(e.actions_taken)}`]).filter(Boolean).join(' ');
  const contribution = hasWork && projectRef ? pick([
    `As ações desenvolvidas no âmbito ${theme} contribuem para ${projectRef}, finalidade central do projeto.`,
    `O conjunto das atividades ${theme} concorre para ${projectRef}, objetivo maior do projeto.`,
    `Os resultados do período, no âmbito ${theme}, somam-se aos esforços voltados ${feminineNoun(projectWord) ? 'à' : 'ao'} ${lower(input.project.title)}.`
  ], 14) : '';
  const upcoming = mode === 'concise' ? [] : continuing;
  const upcomingNames = upcoming.map((a) => withArticle(short(nominalize(a.title), 90)));
  const upcomingOf = upcoming.map((a) => { const n = short(nominalize(a.title), 90); return `${n.feminine ? 'da' : 'do'} ${lower(n.text)}`; });
  const next = upcoming.length ? pick([
    `Para o período subsequente (${describeMonths(nextMonths)}), o cronograma individualizado prevê a continuidade de ${upcoming.length === 1 ? 'uma atividade' : `${upcoming.length} atividades`}${mode === 'detailed' ? `: ${join(upcomingNames)}` : `, entre elas ${series(upcomingNames.slice(0, 3))}`}.`,
    `Nos próximos meses (${describeMonths(nextMonths)}), o cronograma mantém programadas ${upcoming.length === 1 ? 'uma atividade' : `${upcoming.length} atividades`}${mode === 'detailed' ? `: ${join(upcomingNames)}` : `, com destaque para ${series(upcomingNames.slice(0, 2))}`}.`,
    `A etapa seguinte, de ${describeMonths(nextMonths)}, prevê no cronograma a continuidade ${mode === 'detailed' ? `das seguintes atividades: ${join(upcomingNames)}` : `${series(upcomingOf.slice(0, 3))}${upcoming.length > 3 ? ', entre outras' : ''}`}.`
  ], 15) : '';
  const closing = !hasWork ? '' : lastPeriod
    ? 'Com este relatório, conclui-se o ciclo de atividades previsto no cronograma individualizado da bolsa.'
    : pick([
      expected[0] ? `Dessa forma, o período contribuiu para o avanço das entregas previstas, como ${lower(cutAt(bare(expected[0]), 90))}, com continuidade assegurada pelo cronograma.` : `Dessa forma, o período contribuiu para o avanço das entregas ${theme}, com continuidade assegurada pelo cronograma.`,
      `As atividades ${theme} seguem alinhadas às metas do projeto, com continuidade programada para os próximos ${total && elapsed < total ? `${total - elapsed} meses` : 'meses'} de vigência.`,
      `Os resultados alcançados até o momento reforçam a continuidade das ações ${theme}, com observância das normas aplicáveis e do cronograma estabelecido.`,
      `Com isso, mantém-se o encadeamento das ações ${theme}, em sintonia com as metas e o cronograma do projeto.`
    ], 16);
  const additional = [[summary, interlocution].filter(Boolean).join(' '), extras, [contribution, next].filter(Boolean).join(' '), closing].filter(Boolean).join('\n\n');

  const content: ReportContent = {
    heading: { foundation: input.project.support_foundation, form: 'FORMULÁRIO 9', title: 'RELATÓRIO TÉCNICO PARCIAL (RTP)', project: input.project.title, scholar: input.scholar.full_name, scholarshipPeriod: `${monthYear(input.scholar.starts_on)} a ${monthYear(input.scholar.ends_on)}`, number: input.number },
    sections: { results, comparison, additional: additional || 'Não foram registradas informações complementares relevantes para o período.' },
    closing: { placeAndDate: `${input.project.city}, ${longDate(input.issuedOn)}`, scholar: input.scholar.full_name, role: 'Bolsista' }, pending: []
  };
  // Traceability keeps which activities were reported from the schedule alone.
  return { content, traceability: { attempt, objectives: objectives.map((x) => x.id), scheduledActivities: scheduled.map((x) => x.id), executedActivities: executed.map((x) => x.id), reportedFromSchedule: assumed.map((x) => x.id), executions: done.map((x) => x.id), upcoming: upcoming.map((x) => x.id) } };
}

/** Sentences of a report body, normalized, for comparison between reports. */
export function sentencesOf(texts: string[]) {
  // Only the narrative counts: list leads ("…foram as seguintes:") are fixed by request,
  // and bullet items are the plan's own activities and products, facts of each plan.
  return texts.flatMap((t) => t.split(/\n+|(?<=[.:;])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ•])/)).filter((s) => !s.trim().endsWith(':') && !s.trim().startsWith('•')).map((s) => normal(s)).filter((s) => s.length >= 40);
}

/**
 * Generates the report trying several phrasings and keeps the one that repeats
 * the fewest sentences already used in other reports of the project, so no two
 * members receive the same text. Deterministic for the same inputs.
 */
export function generateDistinct(input: Input, existingTexts: string[], attempts = 24) {
  const taken = new Set(sentencesOf(existingTexts));
  let best: ReturnType<typeof generateReport> | null = null, bestScore = Infinity;
  for (let attempt = 0; attempt < attempts && bestScore > 0; attempt++) {
    const candidate = generateReport(input, attempt);
    const score = sentencesOf(Object.values(candidate.content.sections)).filter((s) => taken.has(s)).length;
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return { ...best!, repeatedSentences: bestScore };
}

export function validateReport(content: ReportContent, input: Input) {
  const findings: Array<{ severity: string; code: string; message: string; location: string; source_reference: object }> = [];
  if (input.planStatus && input.planStatus !== 'confirmed') findings.push({ severity: 'attention', code: 'PLAN_NOT_CONFIRMED', message: 'O Plano de Trabalho ainda não foi conferido e confirmado por um responsável.', location: 'Plano de Trabalho', source_reference: { planStatus: input.planStatus } });
  if (!input.planItems.some((x) => x.item_type === 'objective')) findings.push({ severity: 'attention', code: 'NO_OBJECTIVES', message: 'Objetivos individuais não foram confirmados no plano.', location: 'Seção 1.1', source_reference: {} });
  const unscheduled = input.planItems.filter((x) => x.item_type === 'activity' && !hasSchedule(x));
  if (unscheduled.length) findings.push({ severity: 'attention', code: 'ACTIVITY_WITHOUT_SCHEDULE', message: `${unscheduled.length} atividade(s) do plano sem meses no cronograma; foram tratadas como previstas para qualquer período.`, location: 'Cronograma', source_reference: { activities: unscheduled.map((x) => x.id) } });
  // Internal control only (never printed): activities written as executed on the
  // strength of the cronograma, without an individual execution record.
  const fromSchedule = input.planItems.filter((a) => a.item_type === 'activity' && isScheduledIn(a, input.periodStart, input.periodEnd)
    && !input.executions.some((e) => e.plan_item_id === a.id));
  if (fromSchedule.length) findings.push({ severity: 'attention', code: 'REPORTED_FROM_SCHEDULE', message: `${fromSchedule.length} atividade(s) relatada(s) como executada(s) com base no cronograma, sem registro individual de execução no período.`, location: 'Seção 1.1', source_reference: { activities: fromSchedule.map((a) => a.id) } });
  content.pending.forEach((p) => findings.push({ severity: 'attention', code: 'UNCONFIRMED_ACTIVITY', message: p.reason, location: 'Seção 1.1', source_reference: { activity: p.activity } }));
  for (const e of input.executions) {
    if (e.execution_start && (e.execution_start < input.periodStart || e.execution_start > input.periodEnd)) findings.push({ severity: 'critical', code: 'OUTSIDE_PERIOD', message: 'Registro de execução fora do período do RTP.', location: 'Seção 1.1', source_reference: { executionId: e.id } });
    const item = input.planItems.find((i) => i.id === e.plan_item_id);
    if (item?.scheduled_months?.length && !isScheduledIn(item, e.period_start, e.period_end)) findings.push({ severity: 'attention', code: 'OUTSIDE_SCHEDULE', message: `Execução registrada fora dos meses previstos no cronograma para "${bare(item.title).slice(0, 80)}".`, location: 'Seção 1.2', source_reference: { executionId: e.id, planItemId: item.id } });
  }
  if (!input.executions.some((e) => e.result || e.product)) findings.push({ severity: 'suggestion', code: 'NO_EVIDENCED_RESULTS', message: 'Nenhum resultado ou produto foi confirmado para o período.', location: 'Seções 1.1 e 1.2', source_reference: {} });
  return findings;
}
