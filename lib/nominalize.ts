// Turns a work-plan activity written as infinitives into the nominal form used
// in technical reports: "Planejar, organizar e acompanhar a execução…" becomes
// "Planejamento, organização e acompanhamento da execução…". Unknown openings
// are returned unchanged, so the text is never distorted.

type Noun = { noun: string; feminine: boolean };
const m = (noun: string): Noun => ({ noun, feminine: false });
const f = (noun: string): Noun => ({ noun, feminine: true });

const verbs: Record<string, Noun> = {
  planejar: m('planejamento'), organizar: f('organização'), acompanhar: m('acompanhamento'), elaborar: f('elaboração'),
  monitorar: m('monitoramento'), desenvolver: m('desenvolvimento'), analisar: f('análise'), consolidar: f('consolidação'),
  apoiar: m('apoio'), articular: f('articulação'), integrar: f('integração'), identificar: f('identificação'),
  coordenar: f('coordenação'), supervisionar: f('supervisão'), orientar: f('orientação'), prestar: f('prestação'),
  realizar: f('realização'), promover: f('promoção'), levantar: m('levantamento'), avaliar: f('avaliação'),
  definir: f('definição'), propor: f('proposição'), revisar: f('revisão'), validar: f('validação'),
  participar: f('participação'), estruturar: f('estruturação'), receber: m('recebimento'), auxiliar: m('auxílio'),
  contribuir: f('contribuição'), manter: f('manutenção'), sistematizar: f('sistematização'), aplicar: f('aplicação'),
  padronizar: f('padronização'), assegurar: f('garantia'), garantir: f('garantia'), executar: f('execução'),
  implementar: f('implementação'), produzir: f('produção'), registrar: m('registro'), controlar: m('controle'),
  gerenciar: m('gerenciamento'), assessorar: m('assessoramento'), subsidiar: m('subsídio'), fomentar: m('fomento'),
  mapear: m('mapeamento'), caracterizar: f('caracterização'), compatibilizar: f('compatibilização'), normalizar: f('normalização'),
  preparar: f('preparação'), conferir: f('conferência'), coletar: f('coleta'), atualizar: f('atualização'),
  verificar: f('verificação'), emitir: f('emissão'), instruir: f('instrução'), encaminhar: m('encaminhamento'),
  documentar: f('documentação'), divulgar: f('divulgação'), publicar: f('publicação'), redigir: f('redação'),
  criar: f('criação'), construir: f('construção'), calcular: m('cálculo'), modelar: f('modelagem'),
  processar: m('processamento'), georreferenciar: m('georreferenciamento'), quantificar: f('quantificação'),
  investigar: f('investigação'), pesquisar: f('pesquisa'), estudar: m('estudo'), discutir: f('discussão'),
  formular: f('formulação'), capacitar: f('capacitação'), treinar: m('treinamento'), mobilizar: f('mobilização'),
  atender: m('atendimento'), conduzir: f('condução'), fornecer: m('fornecimento'), gerir: f('gestão'),
  incentivar: m('incentivo'), viabilizar: f('viabilização'), otimizar: f('otimização'), priorizar: f('priorização'),
  zelar: m('zelo'), dimensionar: m('dimensionamento'), diagnosticar: m('diagnóstico'), apresentar: f('apresentação'),
  inserir: f('inserção'), alimentar: f('alimentação')
};
// Heads that take an indirect object: "apoio à elaboração", not "apoio da elaboração".
const dative = new Set(['apoio', 'auxílio', 'assessoramento', 'subsídio', 'contribuição', 'suporte', 'atendimento', 'incentivo', 'fomento', 'zelo']);
const prepositions = /^(na|no|nas|nos|em|à|às|ao|aos|com|para|junto|sobre|entre|por|pelo|pela|pelos|pelas|de|do|da|dos|das|perante|mediante|conforme|quanto)\b/i;
const key = (w: string) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const verbPattern = new RegExp(`(\\s+e\\s+|,\\s+)(?=(?:${Object.keys(verbs).join('|')})\\b)`, 'i');

// Contracted article per regime: "da execução", "à elaboração", "nos estudos".
const contractions: Record<'de' | 'a' | 'em', Record<string, string>> = {
  de: { a: 'da', o: 'do', as: 'das', os: 'dos' },
  a: { a: 'à', o: 'ao', as: 'às', os: 'aos' },
  em: { a: 'na', o: 'no', as: 'nas', os: 'nos' }
};
const regime = (noun: string): 'de' | 'a' | 'em' => (noun === 'participação' ? 'em' : dative.has(noun) ? 'a' : 'de');
// "Monitorar periodicamente o cronograma" → "Monitoramento periódico do cronograma".
const adverbs: Record<string, [string, string]> = {
  periodicamente: ['periódico', 'periódica'], continuamente: ['contínuo', 'contínua'], sistematicamente: ['sistemático', 'sistemática'],
  permanentemente: ['permanente', 'permanente'], regularmente: ['regular', 'regular'], tecnicamente: ['técnico', 'técnica'],
  mensalmente: ['mensal', 'mensal'], semanalmente: ['semanal', 'semanal'], constantemente: ['constante', 'constante'], diretamente: ['direto', 'direta']
};

function connect(head: Noun, object: string) {
  const o = object.trim();
  if (!o) return '';
  if (prepositions.test(o)) return ` ${o}`;
  const map = contractions[regime(head.noun)];
  // Coordinated objects in the main clause each take the contraction:
  // "a execução física, o cumprimento… e o alcance…" → "da execução física, do cumprimento… e do alcance…".
  // Only the object noun phrase: stop before gerund and purpose clauses ("para subsidiar os…").
  const [main, ...rest] = o.split(/(?=,\s+\S+(?:ando|endo|indo)\b|\s+(?:para|que|visando|a fim de|com vistas a)\s)/);
  const article = main.match(/^(a|o|as|os)\s+/i)?.[1].toLowerCase();
  let body = article ? `${map[article]}${main.slice(article.length)}` : `${regime(head.noun) === 'em' ? 'em' : regime(head.noun) === 'a' ? 'a' : 'de'} ${main}`;
  body = body.replace(/(,\s+|\s+e\s+)(a|o|as|os)\s+(?=[a-zà-ú])/g, (_, sep: string, art: string) => `${sep}${map[art.toLowerCase()]} `);
  return ` ${body}${rest.join('')}`;
}

/** Nominal form plus the grammatical gender of its first noun (for "quanto ao/à"). */
export function nominalize(text: string): { text: string; feminine: boolean; changed: boolean; headLength: number } {
  const source = text.trim().replace(/[\s;:.]+$/, '');
  const heads: Noun[] = [];
  let rest = source;
  for (;;) {
    const match = rest.match(heads.length ? /^(\s*,\s*|\s+e\s+)([A-Za-zÀ-ú]+)/ : /^()([A-Za-zÀ-ú]+)/);
    const verb = match && verbs[key(match[2])];
    if (!match || !verb) break;
    rest = rest.slice(match[0].length);
    if (key(match[2]) === 'manter' && /^\s+atualizad[ao]s?\b/i.test(rest)) { rest = rest.replace(/^\s+atualizad[ao]s?\b/i, ''); heads.push(f('atualização')); continue; }
    if (key(match[2]) === 'prestar' && /^\s+(suporte|apoio|assessoria|assistência)\b/i.test(rest)) { heads.push(verb); continue; }
    heads.push(verb);
  }
  if (!heads.length) return { text: source, feminine: false, changed: false, headLength: 0 };
  // Later coordinated verbs ("… e propor medidas") are nominalized as well.
  const parts = rest.split(verbPattern);
  let object = parts[0];
  const tail: string[] = [];
  for (let i = 1; i < parts.length; i += 2) tail.push(`${parts[i]}${nominalize(parts[i + 1]).text.replace(/^./, (c) => c.toLowerCase())}`);
  const names = heads.map((h) => h.noun);
  const adverb = object.match(/^\s+([a-zà-ú]+mente)\b/i)?.[1].toLowerCase();
  if (adverb && adverbs[adverb]) { const last = heads[heads.length - 1]; names[names.length - 1] += ` ${adverbs[adverb][last.feminine ? 1 : 0]}`; object = object.replace(/^\s+[a-zà-ú]+mente\b/i, ''); }
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : names[0];
  const result = `${list}${connect(heads[heads.length - 1], object)}${tail.join('')}`;
  // headLength marks where the list of nouns ends, so callers can shorten the phrase at its first comma after it.
  return { text: result.charAt(0).toLocaleUpperCase('pt-BR') + result.slice(1), feminine: heads[0].feminine, changed: true, headLength: list.length };
}

/** "ao planejamento…" / "à gestão…" */
export const toThe = (n: { text: string; feminine: boolean }) => `${n.feminine ? 'à' : 'ao'} ${n.text.charAt(0).toLocaleLowerCase('pt-BR')}${n.text.slice(1)}`;
/** "no planejamento…" / "na gestão…" */
export const inThe = (n: { text: string; feminine: boolean }) => `${n.feminine ? 'na' : 'no'} ${n.text.charAt(0).toLocaleLowerCase('pt-BR')}${n.text.slice(1)}`;

/** The main clause of an objective, without trailing purpose clauses ("…, promovendo…"). */
export function mainClause(text: string, max = 220) {
  const cut = text.split(/,\s+(?=\S+(?:ando|endo|indo)\b|de modo|de forma|com vistas|a fim|bem como)/i)[0];
  if (cut.length <= max) return cut.replace(/[\s;:.]+$/, '');
  const comma = cut.lastIndexOf(',', max);
  return (comma > 80 ? cut.slice(0, comma) : cut.slice(0, max)).replace(/[\s;:.]+$/, '');
}
