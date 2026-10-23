import { describe, expect, it } from 'vitest';
import { identifyScholar } from '../server/services/document.js';
import { generateReport, validateReport } from '../server/services/report.js';

// Dados de teste fictícios, identificados como tal; não correspondem a bolsistas reais.
const scholars = [{ id: 's1', full_name: 'Teste Ana Cartógrafa' }, { id: 's2', full_name: 'Teste Bruno Financeiro' }];
const base = {
  project: { title: 'Projeto de Teste', support_foundation: 'FAPTO', city: 'Palmas – TO' },
  scholar: { full_name: 'Teste Ana Cartógrafa', starts_on: '2026-01-01', ends_on: '2026-12-31' },
  number: '01/2026', periodStart: '2026-01-01', periodEnd: '2026-03-31', issuedOn: '2026-04-05'
};

describe('identificação do bolsista na importação', () => {
  it('associa o plano pelo nome completo, ignorando acentos e caixa', () => {
    const r = identifyScholar('PLANO DE TRABALHO INDIVIDUAL\nBolsista: TESTE ANA CARTOGRAFA\nObjetivos', scholars);
    expect(r).toEqual({ status: 'found', scholar: scholars[0] });
  });
  it('não escolhe bolsista quando o documento cita dois', () => {
    const r = identifyScholar('Equipe: Teste Ana Cartógrafa e Teste Bruno Financeiro', scholars);
    expect(r.status).toBe('ambiguous');
  });
  it('não associa por nome parcial', () => {
    expect(identifyScholar('Responsável: Ana', scholars).status).toBe('none');
  });
});

describe('desvios e conferência do plano', () => {
  it('relata reprogramação com a justificativa e não a trata como concluída', () => {
    const input = { ...base, planItems: [{ id: 'a1', item_type: 'activity', title: 'Levantamento de campo' }], executions: [{ id: 'e1', plan_item_id: 'a1', status: 'rescheduled', planned_activity: 'Levantamento de campo', notes: 'chuvas atrasaram o acesso; novo prazo em maio', executed_activity: '' }] };
    const { content } = generateReport(input);
    expect(content.sections.comparison).toContain('Levantamento de campo (reprogramada: chuvas atrasaram o acesso');
    expect(content.sections.results).not.toContain('confirmam');
    expect(content.pending).toHaveLength(0);
  });
  it('sinaliza plano ainda não conferido', () => {
    const input = { ...base, planStatus: 'pending_review', planItems: [], executions: [] };
    const { content } = generateReport(input);
    expect(validateReport(content, input).some((f) => f.code === 'PLAN_NOT_CONFIRMED')).toBe(true);
  });
});
