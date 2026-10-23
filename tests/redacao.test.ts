import { describe, expect, it } from 'vitest';
import { mainClause, nominalize, toThe } from '../lib/nominalize';
import { generateReport } from '../server/services/report';

// Frases no estilo dos Planos de Trabalho; bolsistas e dados fictícios.

describe('nominalização das atividades', () => {
  it('converte a lista de verbos e contrai o artigo do objeto', () => {
    expect(nominalize('Planejar, organizar e acompanhar a execução orçamentária e financeira;').text).toBe('Planejamento, organização e acompanhamento da execução orçamentária e financeira');
    expect(nominalize('Identificar e analisar riscos e pontos críticos;').text).toBe('Identificação e análise de riscos e pontos críticos');
  });
  it('usa a regência correta', () => {
    expect(nominalize('Apoiar a preparação e a realização das atividades de campo;').text).toBe('Apoio à preparação e à realização das atividades de campo');
    expect(nominalize('Auxiliar na coleta de dados;').text).toBe('Auxílio na coleta de dados');
    expect(nominalize('Prestar suporte à Coordenação Geral;').text).toBe('Prestação de suporte à Coordenação Geral');
  });
  it('trata advérbio, verbo coordenado e "manter atualizadas"', () => {
    expect(nominalize('Monitorar periodicamente o cronograma;').text).toBe('Monitoramento periódico do cronograma');
    expect(nominalize('Elaborar análises e propor medidas de adequação;').text).toBe('Elaboração de análises e proposição de medidas de adequação');
    expect(nominalize('Receber e manter atualizadas as informações;').text).toBe('Recebimento e atualização das informações');
  });
  it('não contrai depois de oração de finalidade', () => {
    expect(nominalize('Elaborar estudos para subsidiar os diagnósticos e os cenários;').text).toBe('Elaboração de estudos para subsidiar os diagnósticos e os cenários');
  });
  it('preserva o texto quando não reconhece o verbo', () => {
    expect(nominalize('Reuniões mensais com a equipe').changed).toBe(false);
  });
  it('forma o foco a partir do objetivo geral', () => {
    expect(`quanto ${toThe(nominalize(mainClause('Planejar e supervisionar a gestão financeira do projeto, promovendo o controle dos recursos.')))}`).toBe('quanto ao planejamento e supervisão da gestão financeira do projeto');
  });
});

describe('redação do RTP', () => {
  const planItems = [
    { id: 'g', item_type: 'objective', title: 'Planejar e supervisionar a gestão financeira do projeto.', source_reference: { section: 'general' } },
    { id: 'o1', item_type: 'objective', title: 'Acompanhar despesas;' },
    { id: 'a1', item_type: 'activity', title: 'Planejar, organizar e acompanhar a execução orçamentária e financeira;', scheduled_months: ['2026-09', '2026-10'] },
    { id: 'a2', item_type: 'activity', title: 'Elaborar relatórios gerenciais;', scheduled_months: ['2026-10'] }
  ];
  const base = {
    project: { title: 'Projeto de Teste', support_foundation: 'FAPTO', city: 'Palmas – TO' },
    scholar: { id: 's1', full_name: 'Teste Fictício Silva', starts_on: '2026-09-17', ends_on: '2027-11-01' },
    planItems, number: '01/2026', periodStart: '2026-09-01', periodEnd: '2026-10-31', issuedOn: '2026-10-21'
  };
  const confirmed = [{ id: 'e1', plan_item_id: 'a1', status: 'completed', period_start: '2026-09-01', period_end: '2026-10-31', planned_activity: planItems[2].title, executed_activity: planItems[2].title }];

  it('não cita o nome do bolsista no texto, só no cabeçalho e no fechamento', () => {
    const { content } = generateReport({ ...base, executions: confirmed });
    const text = Object.values(content.sections).join(' ');
    expect(text).not.toContain('Teste Fictício');
    expect(content.heading.scholar).toBe('Teste Fictício Silva');
    expect(content.closing.scholar).toBe('Teste Fictício Silva');
  });

  it('usa vigência em mês/ano e data por extenso', () => {
    const { content } = generateReport({ ...base, executions: [] });
    expect(content.heading.scholarshipPeriod).toBe('09/2026 a 11/2027');
    expect(content.closing.placeAndDate).toBe('Palmas – TO, 21 de outubro de 2026');
  });

  it('lista como executadas as atividades do cronograma, sem frases de dúvida', () => {
    const { content } = generateReport({ ...base, executions: confirmed });
    const text = Object.values(content.sections).join('\n');
    expect(content.sections.results).toMatch(/executadas no período[^\n]*\n• Planejamento, organização e acompanhamento da execução orçamentária e financeira\.\n• Elaboração de relatórios gerenciais\./);
    expect(text).not.toMatch(/pendente|não foram localizad|não há produtos|comprovad|sem registro/i);
    expect(content.pending).toEqual([]);
  });

  it('usa o texto registrado e o resultado quando a execução foi detalhada', () => {
    const detailed = [{ ...confirmed[0], executed_activity: 'Implantou a planilha de controle orçamentário do projeto', result: 'despesas conciliadas mensalmente' }];
    const { content } = generateReport({ ...base, executions: detailed });
    expect(content.sections.results).toContain('• Implantou a planilha de controle orçamentário do projeto, com o seguinte resultado: despesas conciliadas mensalmente.');
  });

  it('varia a redação entre bolsistas mantendo-a estável para o mesmo relatório', () => {
    const openings = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => generateReport({ ...base, scholar: { ...base.scholar, id }, executions: confirmed }).content.sections.results.split('.')[0].slice(0, 25)));
    expect(openings.size).toBeGreaterThan(1);
    const once = generateReport({ ...base, executions: confirmed }).content.sections.results;
    expect(generateReport({ ...base, executions: confirmed }).content.sections.results).toBe(once);
  });
});
