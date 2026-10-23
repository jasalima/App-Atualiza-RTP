import { describe, expect, it } from 'vitest';
import { describeMonths, isScheduledIn } from '../lib/schedule';
import { structurePlan } from '../server/services/document';
import { generateReport } from '../server/services/report';
import { parseMonthLabel, parseValidity, scheduleFromHtml, scheduleFromItems, type PositionedItem } from '../server/services/schedule';

// Dados de teste fictícios, no formato do Formulário 29; não correspondem a bolsistas reais.

describe('cabeçalhos de meses do cronograma', () => {
  it('lê grupos de meses com o ano ao final', () => {
    expect(parseMonthLabel('Set;Out;Nov;Dez2026')).toEqual(['2026-09', '2026-10', '2026-11', '2026-12']);
    expect(parseMonthLabel('Out;Nov 2027')).toEqual(['2027-10', '2027-11']);
  });
  it('vira o ano quando o grupo atravessa dezembro', () => {
    expect(parseMonthLabel('Nov;Dez 2026 Jan 2027')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(parseMonthLabel('Dez;Jan;Fev', { after: '2026-11' })).toEqual(['2026-12', '2027-01', '2027-02']);
  });
  it('resolve "Mês N" a partir do início da vigência', () => {
    expect(parseMonthLabel('Mês 3', { start: '2026-09' })).toEqual(['2026-11']);
  });
  it('lê a vigência da bolsa', () => {
    expect(parseValidity('Vigência da Bolsa: 09/2026 a 11/2027')).toEqual({ start: '2026-09', end: '2027-11' });
  });
});

// Builds a positioned PDF page like the FAPTO cronograma: header fragments stacked
// in narrow columns, activity text on the left, X marks centred in each row.
function page(rows: Array<{ lines: string[]; marks: number[] }>): PositionedItem[] {
  const cols = [421, 446, 474, 503, 533];
  const headers = [['Se', 't;', 'O', 'ut;', 'N', 'ov', ';', 'De', 'z', '20', '26'], ['Ja', 'n;', 'Fe', 'v;', 'M', 'ar', '20', '27'], ['A', 'br;', 'M', 'ai;', 'Ju', 'n', '20', '27'], ['Jul', ';', 'A', 'go', ';S', 'et', '20', '27'], ['Out', ';', 'No', 'v', '202', '7']];
  const items: PositionedItem[] = [{ page: 3, x: 200, y: 700, w: 300, s: 'CRONOGRAMA DE ATIVIDADES INDIVIDUALIZADO' }, { page: 3, x: 88, y: 680, w: 400, s: 'O cronograma abaixo descreve as atividades.' }, { page: 3, x: 469, y: 650, w: 30, s: 'Meses' }, { page: 3, x: 200, y: 590, w: 50, s: 'Atividades' }];
  headers.forEach((frags, c) => frags.forEach((s, k) => items.push({ page: 3, x: cols[c] - 4, y: 634 - k * 14, w: 9, s })));
  let y = 480;
  for (const row of rows) {
    const top = y;
    row.lines.forEach((s) => { items.push({ page: 3, x: 88, y, w: 300, s }); y -= 14; });
    const centre = (top + y + 14) / 2;
    row.marks.forEach((c) => items.push({ page: 3, x: cols[c] - 4, y: centre, w: 8, s: 'X' }));
    y -= 10;
  }
  return items;
}

describe('leitura do cronograma no PDF', () => {
  it('liga cada marcação X à coluna e à atividade certas, inclusive com lacunas', () => {
    const schedule = scheduleFromItems(page([
      { lines: ['Estruturar o acompanhamento das metas e entregas', 'previstas no Plano de Trabalho;'], marks: [0, 1, 2, 3, 4] },
      { lines: ['Elaborar o diagnóstico hídrico preliminar;'], marks: [1, 3] }
    ]));
    expect(schedule?.columns.map((c) => c.months.length)).toEqual([4, 3, 3, 3, 2]);
    expect(schedule?.rows[0].activity).toBe('Estruturar o acompanhamento das metas e entregas previstas no Plano de Trabalho;');
    expect(schedule?.rows[0].months).toHaveLength(15);
    expect(schedule?.rows[1].months).toEqual(['2027-01', '2027-02', '2027-03', '2027-07', '2027-08', '2027-09']);
  });

  it('lê a tabela do DOCX', () => {
    const html = '<h2>CRONOGRAMA DE ATIVIDADES INDIVIDUALIZADO</h2><table><tr><td>Atividades</td><td>Meses</td></tr><tr><td></td><td>Set;Out 2026</td><td>Nov;Dez 2026</td></tr><tr><td>Organizar registros de campo;</td><td>X</td><td></td></tr></table>';
    expect(scheduleFromHtml(html)?.rows[0]).toMatchObject({ activity: 'Organizar registros de campo;', months: ['2026-09', '2026-10'] });
  });
});

describe('seções do Formulário 29', () => {
  const text = [
    'PLANO DE TRABALHO DO BOLSISTA', 'Bolsista: Teste Bolsista Fictício', 'Vigência da Bolsa: 09/2026 a 11/2027',
    '1. Objetivo Geral:', 'Apoiar a coordenação no acompanhamento', 'do projeto de teste.',
    '2. Objetivos Específicos:', '● Monitorar metas;', '● Consolidar informações gerenciais', 'para a coordenação;',
    '3. Atividades a serem executadas:', '● Elaborar o diagnóstico hídrico preliminar, considerando as', 'atividades, metas e etapas do plano;', '● Organizar registros de campo;',
    '4. Produto(s) esperado(s), inclusive a produção técnica-científica (quando for o caso):', '● Relatório de diagnóstico;',
    'Fundamento Legal: Lei 8.958/04', '2', '5. Referencial bibliográfico:', 'CRONOGRAMA DE ATIVIDADES INDIVIDUALIZADO', 'Elaborar o diagnóstico X X'
  ].join('\n');

  it('separa objetivo geral, específicos, atividades e produtos pelos marcadores', () => {
    const { items } = structurePlan(text);
    expect(items.objective.map((o) => o.title)).toEqual(['Apoiar a coordenação no acompanhamento do projeto de teste.', 'Monitorar metas;', 'Consolidar informações gerenciais para a coordenação;']);
    expect(items.objective[0].source_reference.section).toBe('general');
    expect(items.activity.map((a) => a.title)).toEqual(['Elaborar o diagnóstico hídrico preliminar, considerando as atividades, metas e etapas do plano;', 'Organizar registros de campo;']);
    expect(items.product.map((p) => p.title)).toEqual(['Relatório de diagnóstico;']);
  });

  it('anexa os meses do cronograma à atividade correspondente', () => {
    const schedule = { columns: [], rows: [{ activity: 'Elaborar o diagnóstico hídrico preliminar, considerando as atividades, metas e etapas do plano;', columns: [1], months: ['2027-01', '2027-02'] }] };
    const { items } = structurePlan(text, schedule);
    expect(items.activity[0]).toMatchObject({ scheduled_months: ['2027-01', '2027-02'], starts_on: '2027-01-01', ends_on: '2027-02-28' });
    expect(items.activity[1].scheduled_months).toEqual([]);
  });
});

describe('RTP orientado pelo cronograma', () => {
  const base = {
    project: { title: 'Projeto de Teste', support_foundation: 'FAPTO', city: 'Palmas – TO' },
    scholar: { full_name: 'Teste Bolsista Fictício', starts_on: '2026-09-01', ends_on: '2027-11-30' },
    number: '01/2026', periodStart: '2026-09-01', periodEnd: '2026-12-31', issuedOn: '2027-01-10', executions: []
  };
  const planItems = [
    { id: 'a1', item_type: 'activity', title: 'Estruturar o acompanhamento das metas;', scheduled_months: ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'] },
    { id: 'a2', item_type: 'activity', title: 'Elaborar o diagnóstico hídrico;', scheduled_months: ['2027-04', '2027-05'] }
  ];

  it('relata como executado só o que o cronograma programou para o período', () => {
    const { content } = generateReport({ ...base, planItems });
    expect(content.sections.results).toContain('cronograma de atividades individualizado');
    expect(content.sections.results).toContain('• Estruturação do acompanhamento das metas.');
    expect(content.sections.results).not.toContain('diagnóstico hídrico');
  });

  it('não relata como executada a atividade registrada como reprogramada', () => {
    const executions = [{ id: 'e1', plan_item_id: 'a1', status: 'rescheduled', period_start: '2026-09-01', period_end: '2026-12-31', planned_activity: 'Estruturar o acompanhamento das metas;', notes: 'aguardando definição das metas' }];
    const { content } = generateReport({ ...base, planItems, executions });
    expect(content.sections.results).not.toContain('• Estruturação do acompanhamento das metas');
    expect(content.sections.comparison).toContain('(reprogramada: aguardando definição das metas)');
  });

  it('informa o que o cronograma prevê para o período seguinte', () => {
    const { content } = generateReport({ ...base, planItems });
    expect(content.sections.additional).toMatch(/janeiro de 2027 a março de 2027/);
  });

  it('considera um mês do cronograma dentro do período', () => {
    expect(isScheduledIn(planItems[1], '2027-05-10', '2027-05-20')).toBe(true);
    expect(isScheduledIn(planItems[1], '2027-06-01', '2027-06-30')).toBe(false);
    expect(describeMonths(['2027-04', '2027-05'])).toBe('abril de 2027 a maio de 2027');
  });
});
