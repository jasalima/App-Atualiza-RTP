import { describe, expect, it } from 'vitest';
import { generateReport, validateReport } from '../server/services/report.js';

const base = {
  project: { title: 'Projeto Sustentável', support_foundation: 'FAPTO', city: 'Palmas – TO' },
  scholar: { full_name: 'Ana Técnica', starts_on: '2026-01-01', ends_on: '2026-12-31' },
  number: '01/2026', periodStart: '2026-01-01', periodEnd: '2026-03-31', issuedOn: '2026-04-05'
};

describe('motor de RTP individualizado', () => {
  it('não transforma atividade planejada em realizada sem registro', () => {
    const input = { ...base, planItems: [{ id:'a1', item_type:'objective', title:'Analisar dados' }, { id:'a2', item_type:'activity', title:'Elaborar estudo hídrico' }], executions: [] };
    const { content } = generateReport(input);
    expect(content.sections.results).toContain('não foram localizados registros suficientes');
    expect(content.sections.results).not.toContain('elaborou o estudo hídrico');
    expect(content.pending[0].activity).toBe('Elaborar estudo hídrico');
  });

  it('não incorpora atividade pertencente a outro bolsista', () => {
    const input = { ...base, planItems: [{ id:'ana-1', item_type:'activity', title:'Consolidar base cartográfica' }], executions: [{ id:'ana-ex', plan_item_id:'ana-1', status:'completed', executed_activity:'Consolidou a base cartográfica', result:'Mapa temático' }] };
    const { content } = generateReport(input);
    expect(content.sections.results).toContain('Consolidou a base cartográfica');
    expect(content.sections.results).not.toContain('execução orçamentária de Bruno');
  });

  it('sinaliza execução fora do período como crítica', () => {
    const input = { ...base, planItems: [], executions: [{ id:'e1', status:'completed', execution_start:'2025-12-01', executed_activity:'Atividade anterior' }] };
    const { content } = generateReport(input);
    expect(validateReport(content, input).some(x => x.code === 'OUTSIDE_PERIOD' && x.severity === 'critical')).toBe(true);
  });
});
