import { describe, expect, it } from 'vitest';
import { docText, reflowNodes, reflowText, type RichNode } from '../lib/minutes-model';

const p = (text: string): RichNode => ({ type: 'paragraph', attrs: { indent: 0, textAlign: null }, content: [{ type: 'text', text }] });
const empty: RichNode = { type: 'paragraph', attrs: { indent: 0, textAlign: null } };

describe('reflow of pasted minutes text', () => {
  it('joins lines pasted as one paragraph each', () => {
    const out = reflowNodes([
      p('• Governança e Conformidade Institucional: Gilson enfatizou que a execução do'),
      p('projeto deve estar rigorosamente alinhada aos Termos de Referência (TR) e'),
      p('devidamente submetida e aprovada pelo Comitê de Ética de Pesquisa. Destacou-se'),
      p('que a estrita observância assegura a qualidade institucional frente aos órgãos'),
      p('financiadores e fiscalizadores.'),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('Mecanismos de Flexibilização Técnica (José Lauro e Eliane): José Lauro argumentou')] }] },
      p('sobre a relevância de prever margens de flexibilidade metodológica nos'),
      p('instrumentos de coleta. Eliane sublinhou a importância'),
      p('de aprovação do projeto.'),
      p('Novo parágrafo com maiúscula.'),
      empty, empty, empty
    ]);
    expect(out).toHaveLength(3);
    expect(docText(out[0])).toBe('• Governança e Conformidade Institucional: Gilson enfatizou que a execução do projeto deve estar rigorosamente alinhada aos Termos de Referência (TR) e devidamente submetida e aprovada pelo Comitê de Ética de Pesquisa. Destacou-se que a estrita observância assegura a qualidade institucional frente aos órgãos financiadores e fiscalizadores.');
    expect(docText(out[1])).toBe('Mecanismos de Flexibilização Técnica (José Lauro e Eliane): José Lauro argumentou sobre a relevância de prever margens de flexibilidade metodológica nos instrumentos de coleta. Eliane sublinhou a importância de aprovação do projeto.');
    expect(docText(out[2])).toBe('Novo parágrafo com maiúscula.');
  });
  it('keeps sentence ends, bullets and the formatting of the words', () => {
    const out = reflowNodes([
      { type: 'paragraph', content: [{ type: 'text', text: 'Com ' }, { type: 'text', text: 'ELIANE', marks: [{ type: 'bold' }] }, { type: 'text', text: '  e\nnome. Objetivo: discutir o TR e\ndefinir campo.\n• Planejar a\nestratégia.' }] }
    ]);
    expect(out[0].content).toEqual([
      { type: 'text', text: 'Com ' }, { type: 'text', text: 'ELIANE', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' e nome. Objetivo: discutir o TR e definir campo.' }, { type: 'hardBreak' }, { type: 'text', text: '• Planejar a estratégia.' }
    ]);
  });
  it('reflows the plain objective of the automatic opening', () => {
    expect(reflowText('Discutir a validação junto à APROEST e\ndefinir os instrumentos.\n• Planejar a estratégia\nde submissão.\n\n')).toBe('Discutir a validação junto à APROEST e definir os instrumentos.\n• Planejar a estratégia de submissão.');
  });
  it('is idempotent', () => {
    const once = reflowNodes([p('linha um sem ponto'), p('continua aqui.')]);
    expect(reflowNodes(once)).toEqual(once);
  });
});
