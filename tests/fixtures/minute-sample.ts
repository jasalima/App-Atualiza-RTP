import { createHash } from 'node:crypto';
import { emptyDraft, freezeContent, type MinuteDraft, type RichDoc, type RichNode } from '../../lib/minutes-model';

// The model ata (Produto 1.3, 04/11/2026) as editor content, used by the tests and the render check.
const p = (t: string): RichDoc => ({ type: 'doc', content: t.split('\n\n').map((x) => ({ type: 'paragraph', attrs: { textAlign: 'justify' }, content: [{ type: 'text', text: x }] })) });
const cell = (type: string, t: string, attrs: Record<string, unknown> = {}, bold = false): RichNode => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs }, content: [{ type: 'paragraph', attrs: { textAlign: attrs.align ?? null }, content: [{ type: 'text', text: t, ...(bold ? { marks: [{ type: 'bold' }] } : {}) }] }] });
const item = (t: string): RichNode => ({ type: 'listItem', content: [{ type: 'paragraph', attrs: { textAlign: 'justify' }, content: [{ type: 'text', text: t }] }] });

export const PEOPLE = ['Nilson Denuncio', 'Maxwell Diógenes Bandeira de Melo', 'Adrian da Silva', 'Anderson Sacramento', 'Gustavo Consales'];
export function sampleDraft(): MinuteDraft {
  const d = emptyDraft('Nilson Denuncio');
  Object.assign(d, {
    subject: 'Alinhamento do Produto 1.3 – Mapeamento Cartográfico e Geoespacial do Polo', meetingDate: '2026-11-04', startsAt: '10:05', endsAt: '10:39', chairedBy: 'Nilson Denuncio',
    objective: 'alinhar escopo, prazo, forma de contratação e equipe responsável pelo Produto 1.3 – Mapeamento cartográfico e geoespacial do Polo elaborado'
  });
  d.participants = PEOPLE.map((name, i) => ({ scholarId: null, authUserId: `u${i + 1}`, name, institution: i === 2 ? 'APROEST' : 'UFT', role: i === 0 ? 'Equipe do Projeto' : 'Produto 1.3', email: '', attendance: 'present', signs: true }));
  d.participants.push({ scholarId: null, authUserId: null, name: 'Elaine', institution: 'UFT', role: 'Governança', email: '', attendance: 'justified', signs: false });
  d.topics = [
    { id: 'a', title: 'Apresentação do Produto 1.3 e finalidade', children: [], body: p('Nilson Denuncio apresentou o Produto 1.3 – Mapeamento cartográfico e geoespacial do Polo elaborado, cujas ações previstas são: consolidação cartográfica da área de abrangência do Polo; elaboração de mapas temáticos (uso do solo, recursos hídricos, infraestrutura e situação fundiária); identificação de sistemas de captação, canais e áreas irrigadas.\n\nEsclareceu que o produto alimentará o Data Lake e o site vinculado à Universidade, em construção por outra equipe, de modo que as camadas fiquem disponíveis para consulta pública.') },
    {
      id: 'b', title: 'Área de abrangência e camadas requeridas', body: p('A área de abrangência compreende os municípios de Lagoa da Confusão, Formoso do Araguaia, Pium, Cristalândia, Dueré, Sandolândia e Santa Rita do Tocantins, totalizando aproximadamente 4 (quatro) milhões de hectares.'),
      children: [{ id: 'b1', title: 'Camadas inéditas', children: [], body: { type: 'doc', content: [
        { type: 'bulletList', content: ['sedes de fazendas e estruturas produtivas;', 'áreas de plantio e estradas de acesso, distinguindo vicinais e particulares;', 'pontes → captações ≥ canais.'].map(item) },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Registro do chat: ' }, { type: 'text', text: 'pontes, estradas, fazendas', marks: [{ type: 'bold' }] }, { type: 'text', text: ' e ' }, { type: 'text', text: 'áreas de plantio', marks: [{ type: 'italic' }, { type: 'underline' }] }] }] }
      ] } }]
    },
    {
      id: 'c', title: 'Forma de contratação e valores', children: [], body: { type: 'doc', content: [
        { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Quadro 1 – Quadro financeiro', marks: [{ type: 'bold' }] }] },
        { type: 'table', content: [
          { type: 'tableRow', content: ['Descrição', 'Quantidade', 'Valor', 'Total'].map((t) => cell('tableHeader', t)) },
          ...Array.from({ length: 4 }, (_, i) => ({ type: 'tableRow', content: [`Bolsa profissional ${i + 1}`, '4', 'R$ 4.166,67', 'R$ 16.666,68'].map((t) => cell('tableCell', t)) })),
          { type: 'tableRow', content: [cell('tableCell', 'Total geral', { colspan: 3, backgroundColor: '#FFF3D6', align: 'right' }, true), cell('tableCell', 'R$ 66.666,72')] }
        ] }
      ] }
    }
  ];
  d.decisions = { type: 'doc', content: [{ type: 'bulletList', content: [
    { type: 'listItem', content: [{ type: 'paragraph', attrs: { textAlign: 'justify' }, content: [{ type: 'text', text: 'Equipe do Produto 1.3:', marks: [{ type: 'bold' }] }, { type: 'text', text: ' aprovada a contratação de Anderson Sacramento e Gustavo Consales, sob condução do Prof. Maxwell Diógenes Bandeira de Melo.' }] }] },
    { type: 'listItem', content: [{ type: 'paragraph', attrs: { textAlign: 'justify' }, content: [{ type: 'text', text: 'Cronograma:', marks: [{ type: 'bold' }] }, { type: 'text', text: ' camadas principais até o início de janeiro de 2027.' }] }] }
  ] }] };
  return d;
}
export const PROJECT = 'Plano de Desenvolvimento Sustentável do Polo de Agricultura Irrigada do Sudoeste do Tocantins (TED UFT/MIDR)';
export const sampleContent = () => freezeContent(sampleDraft(), { number: 'ATA Nº 001/2026', projectTitle: PROJECT });
export const fakeSignature = (name: string, roleLabel: string, signedAt: string) => ({ name, roleLabel, signedAt, signatureHash: createHash('sha256').update(name).digest('hex') });
