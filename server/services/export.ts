import { AlignmentType, BorderStyle, Document, ImageRun, Packer, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType } from 'docx';
import PDFDocument from 'pdfkit';
import { FAPTO_LOGO_PNG, FAPTO_LOGO_SIZE } from '../assets/fapto-logo';
import type { ReportContent } from '../types.js';

// Layout of the FAPTO Formulário 9 model: logo, foundation and form name centred;
// an identification table whose first row reads "RELATÓRIO TÉCNICO PARCIAL (RTP)";
// numbered sections; place/date on the right and the scholar's name centred.
export const SECTION_TITLES = {
  part: '1. Resultados Parciais',
  results: '1.1 Objetivos propostos no plano individual versus objetivos alcançados',
  comparison: '1.2 Resultados esperados versus resultados obtidos (conforme cronograma estabelecido)',
  additional: '2. Informações Adicionais'
} as const;
const FRAME = '8EA2BF', SHADE = 'DCE6F2', FONT = 'Times New Roman';
const foundationLine = (c: ReportContent) => c.heading.foundation.toLocaleUpperCase('pt-BR');
const idRows = (c: ReportContent): Array<[string, string, { shade?: boolean; bold?: boolean }]> => [
  ['Título do Projeto', c.heading.project, { shade: true }],
  ['Bolsista:', c.heading.scholar, {}],
  ['Vigência da Bolsa:', c.heading.scholarshipPeriod, { shade: true, bold: true }],
  ['RTP Nº:', c.heading.number, {}]
];
/** Each line of a section is its own paragraph; lines starting with "•" are bullet items. */
const lines = (text: string) => text.split(/\n+/).map((l) => l.trim()).filter(Boolean);

export async function toDocx(c: ReportContent) {
  const run = (text: string, opts: { bold?: boolean; size?: number } = {}) => new TextRun({ text, font: FONT, size: opts.size ?? 24, bold: opts.bold });
  const centred = (text: string, bold = true, after = 120) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after }, children: [run(text, { bold })] });
  const border = { style: BorderStyle.SINGLE, size: 12, color: FRAME };
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const cell = (text: string, opts: { shade?: boolean; bold?: boolean; span?: number; width?: number; bottom?: boolean } = {}) => new TableCell({
    columnSpan: opts.span, verticalAlign: VerticalAlign.CENTER, width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts.shade ? { fill: SHADE, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    borders: { top: none, left: none, right: none, bottom: opts.bottom ? border : none },
    margins: { top: 20, bottom: 20, left: 80, right: 80 },
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(text, { bold: opts.bold })] })]
  });
  const table = new Table({
    layout: TableLayoutType.FIXED, width: { size: 8300, type: WidthType.DXA }, alignment: AlignmentType.CENTER, columnWidths: [2900, 5400],
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: none, insideVertical: border },
    rows: [
      new TableRow({ children: [cell('RELATÓRIO TÉCNICO PARCIAL (RTP)', { span: 2, bold: true, bottom: true })] }),
      ...idRows(c).map(([label, value, o]) => new TableRow({ children: [cell(label, { width: 2900 }), cell(value, { width: 5400, shade: o.shade, bold: o.bold })] }))
    ]
  });
  const heading = (text: string) => new Paragraph({ keepNext: true, keepLines: true, spacing: { before: 240, after: 120 }, children: [run(text, { bold: true })] });
  const body = (text: string) => lines(text).map((l) => new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120, line: 276 }, children: [run(l)] }));
  const doc = new Document({ sections: [{
    properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 1134 } } },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new ImageRun({ type: 'png', data: FAPTO_LOGO_PNG, transformation: { width: 150, height: Math.round(150 * FAPTO_LOGO_SIZE.height / FAPTO_LOGO_SIZE.width) } })] }),
      centred(foundationLine(c), true, 240),
      centred(c.heading.form, true, 240),
      table,
      new Paragraph({ spacing: { after: 120 }, children: [] }),
      heading(SECTION_TITLES.part), heading(SECTION_TITLES.results), ...body(c.sections.results),
      heading(SECTION_TITLES.comparison), ...body(c.sections.comparison),
      heading(SECTION_TITLES.additional), ...body(c.sections.additional),
      new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 360, after: 1200 }, children: [run(c.closing.placeAndDate)] }),
      centred(c.closing.scholar, false, 0),
      centred(c.closing.role, false, 0)
    ]
  }] });
  return Packer.toBuffer(doc);
}

export function toPdf(c: ReportContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 57, bottom: 57, left: 85, right: 57 }, bufferPages: true });
    const chunks: Buffer[] = []; doc.on('data', (b) => chunks.push(b)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const left = doc.page.margins.left, width = doc.page.width - left - doc.page.margins.right, bottom = () => doc.page.height - doc.page.margins.bottom;
    const logoW = 112, logoH = logoW * FAPTO_LOGO_SIZE.height / FAPTO_LOGO_SIZE.width;
    doc.image(FAPTO_LOGO_PNG, left + (width - logoW) / 2, doc.y, { width: logoW });
    doc.y += logoH + 16;
    doc.font('Times-Bold').fontSize(12).text(foundationLine(c), left, doc.y, { width, align: 'center' }).moveDown(0.9);
    doc.text(c.heading.form, { width, align: 'center' }).moveDown(0.9);

    // Identification table.
    const tableW = 415, x0 = left + (width - tableW) / 2, col1 = 145, col2 = tableW - col1, pad = 4;
    const rowH = (text: string, w: number, bold = false) => doc.font(bold ? 'Times-Bold' : 'Times-Roman').fontSize(12).heightOfString(text, { width: w - pad * 2 }) + pad * 2 - 2;
    const top = doc.y;
    let y = top;
    const titleH = rowH('RELATÓRIO TÉCNICO PARCIAL (RTP)', tableW, true);
    doc.font('Times-Bold').text('RELATÓRIO TÉCNICO PARCIAL (RTP)', x0 + pad, y + pad - 1, { width: tableW - pad * 2, align: 'center' });
    y += titleH;
    doc.moveTo(x0, y).lineTo(x0 + tableW, y).lineWidth(1).strokeColor(`#${FRAME}`).stroke();
    const bodyTop = y;
    for (const [label, value, o] of idRows(c)) {
      const h = Math.max(rowH(label, col1), rowH(value, col2, o.bold));
      if (o.shade) doc.rect(x0 + col1, y, col2, h).fill(`#${SHADE}`);
      doc.fillColor('black').font('Times-Roman').text(label, x0 + pad, y + (h - rowH(label, col1)) / 2 + pad - 1, { width: col1 - pad * 2, align: 'center' });
      doc.font(o.bold ? 'Times-Bold' : 'Times-Roman').text(value, x0 + col1 + pad, y + pad - 1, { width: col2 - pad * 2, align: 'center' });
      y += h;
    }
    doc.moveTo(x0 + col1, bodyTop).lineTo(x0 + col1, y).stroke();
    doc.rect(x0, top, tableW, y - top).lineWidth(1.5).stroke();
    doc.y = y + 22;

    const ensure = (needed: number) => { if (doc.y + needed > bottom()) doc.addPage(); };
    const heading = (text: string) => { ensure(70); doc.font('Times-Bold').fontSize(12).fillColor('black').text(text, left, doc.y, { width, align: 'left' }).moveDown(0.45); };
    const body = (text: string) => { for (const l of lines(text)) { ensure(30); doc.font('Times-Roman').fontSize(12).text(l, left, doc.y, { width, align: 'justify', lineGap: 2 }).moveDown(0.45); } };
    heading(SECTION_TITLES.part); heading(SECTION_TITLES.results); body(c.sections.results);
    doc.moveDown(0.5); heading(SECTION_TITLES.comparison); body(c.sections.comparison);
    doc.moveDown(0.5); heading(SECTION_TITLES.additional); body(c.sections.additional);

    ensure(150);
    doc.moveDown(0.8).font('Times-Roman').text(c.closing.placeAndDate, left, doc.y, { width, align: 'right' });
    doc.y += 70;
    doc.text(c.closing.scholar, left, doc.y, { width, align: 'center' }).text(c.closing.role, { width, align: 'center' });
    doc.end();
  });
}
