import { describe, expect, it } from 'vitest';
import { toDocx, toPdf } from '../server/services/export.js';
import type { ReportContent } from '../server/types.js';

const content: ReportContent = {
  heading: { foundation:'FAPTO', form:'FORMULÁRIO 9', title:'RELATÓRIO TÉCNICO PARCIAL (RTP)', project:'Projeto de teste', scholar:'Bolsista de Teste', scholarshipPeriod:'01/01/2026 a 31/12/2026', number:'01/2026' },
  sections: { results:'Resultado confirmado por registro.', comparison:'Comparação documentada.', additional:'Sem informações adicionais.' },
  closing: { placeAndDate:'Palmas – TO, 05/04/2026', scholar:'Bolsista de Teste', role:'Bolsista' },
  pending: []
};

describe('exportação institucional', () => {
  it('gera um DOCX editável válido', async () => {
    const file = await toDocx(content);
    expect(file.subarray(0, 2).toString()).toBe('PK');
    expect(file.length).toBeGreaterThan(1000);
  });

  it('gera um PDF válido', async () => {
    const file = await toPdf(content);
    expect(file.subarray(0, 4).toString()).toBe('%PDF');
    expect(file.length).toBeGreaterThan(1000);
  });
});
