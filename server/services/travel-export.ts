import { AlignmentType, Document, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, HeightRule, WidthType } from 'docx';
import PDFDocument from 'pdfkit';
import { FAPTO_LOGO_PNG, FAPTO_LOGO_SIZE } from '../assets/fapto-logo';

export type TravelBeneficiary = { name: string; phone: string; email: string; project: string; role: string };
/** Filled travel data; absent fields stay as blank lines for handwriting. */
export type TravelFill = { origin?: string; destination?: string; departure?: string | null; returnDate?: string | null; payment?: string | null; objective?: string; entries?: Array<{ date: string; activity: string }> };
const br = (d?: string | null) => d ? d.slice(0, 10).split('-').reverse().join('/') : '____/____/________';
export const travelLeave = (f: TravelFill = {}) => [
  `Cidade/UF origem: ${f.origin?.trim() || blank}`,
  `Cidade/UF destino: ${f.destination?.trim() || blank}`,
  `Saída: ${br(f.departure)}          Retorno: ${br(f.returnDate)}`,
  `Data do pagamento da diária: ${br(f.payment)}`
];
/** At least five rows, as in the model; more when the trip has more entries. */
export const travelEntries = (f: TravelFill = {}) => { const rows = (f.entries ?? []).filter((e) => e.date || e.activity.trim()).map((e) => [e.date ? br(e.date) : '', e.activity.trim()] as [string, string]); while (rows.length < 5) rows.push(['', '']); return rows; };
export const TRAVEL_NOTES = [
  'Observações: Anexar documentos que comprovem o efetivo deslocamento (bilhete de passagem, nota fiscal de hospedagem ou refeição, recibo de táxi e outros);',
  'O formulário devidamente preenchido e assinado deverá ser entregue em até 15 (quinze) dias corridos após o retorno da viagem;',
  'O relatório de viagem, devidamente assinado com assinatura digital e certificado, deve ser enviado para o e-mail do analista do projeto.',
  'Caso o relatório não seja encaminhado no prazo informado, novas diárias não serão liberadas para o Projeto em questão ou outros projetos da mesma coordenação.'
];
export const travelRows = (b: TravelBeneficiary) => [
  `Nome do beneficiário: ${b.name}`,
  `Contato telefônico: ${b.phone}     E-mail: ${b.email}`,
  `Projeto/convênio: ${b.project}`,
  `Função no projeto/convênio: ${b.role}`
];

const blank = '________________________________________________';
export async function travelDocx(b: TravelBeneficiary, fill: TravelFill = {}) {
  const p = (text: string, bold = false, center = false) => new Paragraph({ alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 100 }, children: [new TextRun({ text, bold, font: 'Arial', size: 20 })] });
  const cell = (text: string, bold = false) => new TableCell({ children: [p(text, bold)] });
  return Packer.toBuffer(new Document({ sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, bottom: 720, left: 1000, right: 1000 } } }, children: [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: FAPTO_LOGO_PNG, transformation: { width: 110, height: Math.round(110 * FAPTO_LOGO_SIZE.height / FAPTO_LOGO_SIZE.width) } })] }),
    p('FUNDAÇÃO DE APOIO CIENTÍFICO E TECNOLÓGICO DO TOCANTINS', true, true),
    p('FORMULÁRIO 26', true, true), p('RELATÓRIO DE VIAGEM', true, true),
    p('IDENTIFICAÇÃO DO BENEFICIÁRIO', true), ...travelRows(b).map(t => p(t)),
    p('IDENTIFICAÇÃO DO AFASTAMENTO', true),
    ...travelLeave(fill).map(t => p(t)),
    p('DESCRIÇÃO DA VIAGEM', true),
    p('Descrever o objetivo da viagem e relatar os resultados, assim como outras informações pertinentes'),
    ...(fill.objective?.trim() ? fill.objective.trim().split(/\n+/).map(t => new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 100 }, children: [new TextRun({ text: t, font: 'Arial', size: 20 })] })) : []),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ children: [cell('Data', true), cell('Atividades', true)] }),
      ...travelEntries(fill).map(([d, a]) => new TableRow({ height: { value: 430, rule: HeightRule.ATLEAST }, children: [cell(d), cell(a)] })),
      new TableRow({ cantSplit: true, height: { value: 730, rule: HeightRule.ATLEAST }, children: [cell('Data: ____/____/________'), cell('Assinatura do beneficiário:')] }),
      new TableRow({ cantSplit: true, height: { value: 730, rule: HeightRule.ATLEAST }, children: [cell('Data: ____/____/________'), cell('De acordo (Coordenador do projeto):')] })
    ] }),
    p(''), ...TRAVEL_NOTES.map(t => p(t))
  ] }] }));
}

export function travelPdf(b: TravelBeneficiary, fill: TravelFill = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42 });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const x = 42, w = doc.page.width - 84;
    const logoHeight = 90 * FAPTO_LOGO_SIZE.height / FAPTO_LOGO_SIZE.width;
    doc.image(FAPTO_LOGO_PNG, (doc.page.width - 90) / 2, 30, { width: 90 }); doc.y = 40 + logoHeight;
    const line = (t: string, bold = false, center = false) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(t, x, doc.y, { width: w, align: center ? 'center' : 'left' }).moveDown(.55); };
    line('FUNDAÇÃO DE APOIO CIENTÍFICO E TECNOLÓGICO DO TOCANTINS', true, true);
    line('FORMULÁRIO 26', true, true); line('RELATÓRIO DE VIAGEM', true, true);
    line('IDENTIFICAÇÃO DO BENEFICIÁRIO', true); travelRows(b).forEach(t => line(t));
    line('IDENTIFICAÇÃO DO AFASTAMENTO', true);
    travelLeave(fill).forEach(t => line(t));
    const notesHeight = TRAVEL_NOTES.reduce((sum, note) => sum + doc.font('Helvetica').fontSize(8).heightOfString(note, { width: w }) + 5, 0);
    if (doc.y + 270 + notesHeight + 60 > doc.page.height - 42) doc.addPage();
    line('DESCRIÇÃO DA VIAGEM', true);
    line('Descrever o objetivo da viagem e relatar os resultados, assim como outras informações pertinentes');
    if (fill.objective?.trim()) doc.font('Helvetica').fontSize(10).text(fill.objective.trim(), x, doc.y, { width: w, align: 'justify' }).moveDown(.6);
    let y = doc.y;
    const row = (a: string, c: string, min: number) => {
      const h = Math.max(min, doc.font('Helvetica').fontSize(9).heightOfString(c, { width: w - 130 }) + 12);
      if (y + h > doc.page.height - 42) { doc.addPage(); y = 42; }
      doc.rect(x, y, w, h).stroke(); doc.moveTo(x + 115, y).lineTo(x + 115, y + h).stroke();
      doc.font('Helvetica').fontSize(9).text(a, x + 5, y + 6, { width: 105 }).text(c, x + 120, y + 6, { width: w - 130 }); y += h;
    };
    row('Data', 'Atividades', 22);
    for (const [d, a] of travelEntries(fill)) row(d, a, 23);
    row('Data: ___/___/______', 'Assinatura do beneficiário:', 46);
    row('Data: ___/___/______', 'De acordo (Coordenador do projeto):', 46);
    doc.y = y + 10;
    for (const note of TRAVEL_NOTES) doc.font('Helvetica').fontSize(8).text(note, x, doc.y, { width: w }).moveDown(.4);
    doc.end();
  });
}
