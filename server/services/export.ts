import { AlignmentType, Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import PDFDocument from 'pdfkit';
import type { ReportContent } from '../types.js';

export async function toDocx(c: ReportContent) {
  const rows = [['Título do Projeto', c.heading.project], ['Bolsista', c.heading.scholar], ['Vigência da Bolsa', c.heading.scholarshipPeriod], ['RTP Nº', c.heading.number]];
  const doc = new Document({ sections: [{
    properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('Página '), new TextRun({ children: [PageNumber.CURRENT] })] })] }) },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.heading.foundation, bold: true, size: 22 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.heading.form, bold: true, size: 22 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 320 }, children: [new TextRun({ text: c.heading.title, bold: true, size: 24 })] }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map(([label, value]) => new TableRow({ children: [new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })] }), new TableCell({ width: { size: 75, type: WidthType.PERCENTAGE }, children: [new Paragraph(value)] })] })) }),
      heading('1. RESULTADOS PARCIAIS'), heading('1.1 Objetivos propostos no plano individual versus objetivos alcançados', HeadingLevel.HEADING_2), ...paras(c.sections.results),
      heading('1.2 Resultados esperados versus resultados obtidos', HeadingLevel.HEADING_2), ...paras(c.sections.comparison),
      heading('2. INFORMAÇÕES ADICIONAIS'), ...paras(c.sections.additional),
      new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.RIGHT, text: c.closing.placeAndDate }),
      new Paragraph({ spacing: { before: 900 }, alignment: AlignmentType.CENTER, children: [new TextRun('________________________________________')] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.closing.scholar, bold: true })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, text: c.closing.role })
    ]
  }] });
  return Packer.toBuffer(doc);
}
const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1) => new Paragraph({ heading: level, keepNext: true, spacing: { before: 320, after: 160 }, children: [new TextRun({ text, bold: true })] });
const paras = (text: string) => text.split(/\n\n+/).map((p) => new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 160, line: 360 }, text: p }));

export function toPdf(c: ReportContent): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 55, left: 56, right: 56 }, bufferPages: true });
    const chunks: Buffer[] = []; doc.on('data', (b) => chunks.push(b)); doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.font('Helvetica-Bold').fontSize(10).text(c.heading.foundation, { align: 'center' }).moveDown(.5).text(c.heading.form, { align: 'center' }).fontSize(12).text(c.heading.title, { align: 'center' }).moveDown();
    [['Título do Projeto:', c.heading.project], ['Bolsista:', c.heading.scholar], ['Vigência da Bolsa:', c.heading.scholarshipPeriod], ['RTP Nº:', c.heading.number]].forEach(([k, v]) => { doc.font('Helvetica-Bold').fontSize(9).text(k, { continued: true }).font('Helvetica').text(` ${v}`).moveDown(.3); });
    const section = (title: string, body: string) => { doc.moveDown().font('Helvetica-Bold').fontSize(10).text(title, { continued: false }).moveDown(.4).font('Helvetica').fontSize(10).text(body, { align: 'justify', lineGap: 3 }); };
    section('1. RESULTADOS PARCIAIS', ''); section('1.1 Objetivos propostos no plano individual versus objetivos alcançados', c.sections.results); section('1.2 Resultados esperados versus resultados obtidos', c.sections.comparison); section('2. INFORMAÇÕES ADICIONAIS', c.sections.additional);
    doc.moveDown(2).text(c.closing.placeAndDate, { align: 'right' }).moveDown(3).text('________________________________________', { align: 'center' }).font('Helvetica-Bold').text(c.closing.scholar, { align: 'center' }).font('Helvetica').text(c.closing.role, { align: 'center' });
    const pages = doc.bufferedPageRange(); for (let i = 0; i < pages.count; i++) { doc.switchToPage(i); doc.fontSize(8).text(`Página ${i + 1} de ${pages.count}`, 56, 800, { width: 483, align: 'center' }); }
    doc.end();
  });
}
