import { AlignmentType, BorderStyle, Document, HeightRule, ImageRun, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, Tab, TabStopType, TextRun, VerticalAlign, WidthType } from 'docx';
import PDFDocument from 'pdfkit';
import { FAPTO_LOGO_PNG, FAPTO_LOGO_SIZE } from '../assets/fapto-logo';
import { manifestDocx, manifestPdf, sealDocx, sealPdf, signedDate, type SignatureManifest } from './signature-stamp';

export type TravelBeneficiary = { name: string; phone: string; email: string; project: string; role: string };
/** Filled travel data; absent fields stay as blank lines for handwriting. */
export type TravelFill = { origin?: string; destination?: string; departure?: string | null; returnDate?: string | null; payment?: string | null; objective?: string; entries?: Array<{ date: string; activity: string }>;
  /** JPEG photos inserted by the member on the "Registro fotográfico" page. */
  photos?: Array<{ data: Buffer; width: number; height: number; caption: string }>;
  /** Electronic signatures: stamped on the signature rows and listed on a final manifest page. */
  signatures?: SignatureManifest | null };
/** Fits a photo in a box keeping its proportion. */
const fit = (w: number, h: number, maxW: number, maxH: number) => { const k = Math.min(maxW / w, maxH / h, 1); return { width: Math.round(w * k), height: Math.round(h * k) }; };

const br = (d?: string | null) => d ? d.slice(0, 10).split('-').reverse().join('/') : '____/____/________';
const blank = '________________________________________________';
/** Usual route of the project's field trips; both ends stay editable in each report. */
export const DEFAULT_ORIGIN = 'Palmas/TO', DEFAULT_DESTINATION = 'Lagoa da Confusão/TO';
/** Brazilian mobile/landline layout: (63) 9 8402-8033 or (63) 3218-0000. */
export function formatPhone(raw: string) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d[2]} ${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(raw ?? '').trim();
}
/** Rows of the trip table: the filled entries, or the departure day, or blank lines for a blank form. */
export function travelEntries(f: TravelFill = {}) {
  const rows = (f.entries ?? []).filter((e) => e.date || e.activity.trim()).map((e) => [e.date ? br(e.date) : '', e.activity.trim()] as [string, string]);
  if (!rows.length && f.departure) rows.push([br(f.departure), '']);
  while (rows.length < (f.departure || f.origin || f.destination ? 1 : 3)) rows.push(['', '']);
  return rows;
}
export const TRAVEL_NOTES = [
  'Anexar documentos que comprovem o efetivo deslocamento (bilhete de passagem, nota fiscal de hospedagem ou refeição, recibo de táxi e outros);',
  'O formulário devidamente preenchido e assinado deverá ser entregue em até 15 (quinze) dias corridos após o retorno da viagem;',
  'O relatório de viagem, devidamente assinado com assinatura digital e certificado, deve ser enviado para o e-mail do analista do projeto.',
  'Caso o relatório não seja encaminhado no prazo informado, novas diárias não serão liberadas para o Projeto em questão ou outros projetos da mesma coordenação.'
];
const TITLE = 'FUNDAÇÃO DE APOIO CIENTÍFICO E TECNOLÓGICO DO TOCANTINS';
const INSTRUCTION = 'Descrever o objetivo da viagem e relatar os resultados, assim como outras informações pertinentes';
// Last page: left free for the member to paste the trip photos as they prefer.
export const PHOTO_TITLE = 'REGISTRO FOTOGRÁFICO';
/** Photos are numbered in the order they appear: "Imagem 1 - caption". */
export const photoCaption = (i: number, caption?: string) => `Imagem ${i + 1}${caption?.trim() ? ` - ${caption.trim()}` : ''}`;
const SIGN_LINE =(label: string) => '_'.repeat(Math.max(12, 62 - label.length));

// Measurements taken from the FAPTO Form 26 model (A4, Calibri 11, single spacing).
const FONT = 'Calibri', SIZE = 22, LOGO_PT = 137; // 4,84 cm, as embedded in the official FAPTO forms
const MARGIN = { top: 620, bottom: 720, left: 1701, right: 1620 };
const DATE_COL = 1690, ACT_COL = 7000, ROW_ENTRY = 1040, ROW_HEAD = 470;

export async function travelDocx(b: TravelBeneficiary, fill: TravelFill = {}) {
  type Run = { text: string; bold?: boolean; tab?: boolean };
  const runs = (parts: Run[]) => parts.map((r) => new TextRun({ bold: r.bold, font: FONT, size: SIZE, children: r.tab ? [new Tab(), r.text] : [r.text] }));
  const para = (parts: Run[] | string, o: { after?: number; center?: boolean; justify?: boolean; tab?: number; keep?: boolean } = {}) => new Paragraph({
    alignment: o.center ? AlignmentType.CENTER : o.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
    spacing: { before: 0, after: o.after ?? 200, line: 240 }, keepNext: o.keep,
    tabStops: o.tab ? [{ type: TabStopType.LEFT, position: o.tab }] : undefined,
    children: runs(typeof parts === 'string' ? [{ text: parts }] : parts)
  });
  const lines = (texts: string[], o: { bold?: boolean; center?: boolean; after?: number } = {}) => new Paragraph({
    alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { before: 0, after: o.after ?? 200, line: 240 },
    children: texts.map((text, i) => new TextRun({ text, bold: o.bold, font: FONT, size: SIZE, break: i ? 1 : 0 }))
  });
  const cell = (children: Array<Paragraph | Table>, o: { span?: number; width: number; bottom?: boolean } ) => new TableCell({
    columnSpan: o.span, width: { size: o.width, type: WidthType.DXA }, verticalAlign: o.bottom ? VerticalAlign.BOTTOM : VerticalAlign.TOP,
    margins: { top: 0, bottom: 60, left: 108, right: 108 }, children
  });
  const inCell = (text: string, o: { bold?: boolean; center?: boolean; justify?: boolean } = {}) => para([{ text, bold: o.bold }], { after: 0, center: o.center, justify: o.justify });
  const signature = (label: string, step: number) => {
    const signed = fill.signatures?.signers.find((x) => x.step === step);
    return new TableRow({ cantSplit: true, height: { value: ROW_ENTRY, rule: HeightRule.ATLEAST }, children: [
      cell([inCell(signed ? `Data: ${signedDate(signed.signedAt)}` : 'Data:')], { width: DATE_COL, bottom: true }),
      cell(signed
        ? [para(label, { after: 60 }), sealDocx(signed, { font: FONT, width: ACT_COL - 216 }), para('', { after: 0 })]
        : [para([{ text: `${label} ` }, { text: SIGN_LINE(label) }], { after: 0 })], { width: ACT_COL, bottom: true })
    ] });
  };
  const entries = travelEntries(fill), objective = fill.objective?.trim();
  const logoW = Math.round(LOGO_PT * 96 / 72);
  const year = (fill.departure ?? '').slice(2, 4);

  return Packer.toBuffer(new Document({
    creator: 'RTP Inteligente', title: `Formulário 26 — ${b.name}`,
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: MARGIN } }, children: [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new ImageRun({ type: 'png', data: FAPTO_LOGO_PNG, transformation: { width: logoW, height: Math.round(logoW * FAPTO_LOGO_SIZE.height / FAPTO_LOGO_SIZE.width) } })] }),
      lines([TITLE], { bold: true, center: true, after: 280 }),
      lines(['FORMULÁRIO 26', 'RELATÓRIO DE VIAGEM'], { bold: true, center: true, after: 280 }),
      lines(['IDENTIFICAÇÃO DO BENEFICIÁRIO'], { bold: true, after: 260 }),
      para(`Nome do beneficiário: ${b.name}`),
      para([{ text: `Contato telefônico: ${formatPhone(b.phone)}` }, { text: `E-mail: ${b.email}`, tab: true }], { tab: 4140 }),
      para([{ text: 'Projeto/convênio:', bold: true }, { text: ` ${b.project}` }]),
      para(`Função no projeto/convênio: ${b.role}`),
      lines(['IDENTIFICAÇÃO DO AFASTAMENTO'], { bold: true, after: 260 }),
      lines([`Cidade/UF origem: ${fill.origin?.trim() || DEFAULT_ORIGIN}`, `Cidade/UF destino: ${fill.destination?.trim() || DEFAULT_DESTINATION}`], { after: 280 }),
      para([{ text: `Saída: ${br(fill.departure)}` }, { text: `Retorno: ${br(fill.returnDate)}`, tab: true }], { tab: 2680 }),
      para(`Data do pagamento da diária: ${fill.payment ? br(fill.payment) : year ? `____/____/${year}` : br(null)}`, { after: 120 }),
      new Table({
        width: { size: DATE_COL + ACT_COL, type: WidthType.DXA }, columnWidths: [DATE_COL, ACT_COL], layout: TableLayoutType.FIXED,
        indent: { size: -108, type: WidthType.DXA },
        borders: Object.fromEntries(['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical'].map((k) => [k, { style: BorderStyle.SINGLE, size: 6, color: '000000' }])),
        rows: [
          new TableRow({ cantSplit: true, children: [cell([inCell('DESCRIÇÃO DA VIAGEM', { bold: true, center: true }), inCell(INSTRUCTION, { center: true })], { span: 2, width: DATE_COL + ACT_COL })] }),
          ...(objective ? [new TableRow({ children: [cell(objective.split(/\n+/).map((t, i) => para(i ? [{ text: t }] : [{ text: 'Objetivo: ', bold: true }, { text: t }], { after: 60, justify: true })), { span: 2, width: DATE_COL + ACT_COL })] })] : []),
          new TableRow({ cantSplit: true, height: { value: ROW_HEAD, rule: HeightRule.ATLEAST }, children: [cell([inCell('Data')], { width: DATE_COL }), cell([inCell('Atividades')], { width: ACT_COL })] }),
          ...entries.map(([d, a]) => new TableRow({ height: { value: entries.length > 1 ? 420 : ROW_ENTRY, rule: HeightRule.ATLEAST }, children: [
            cell([inCell(d)], { width: DATE_COL }),
            cell(a ? a.split(/\n+/).map((t) => inCell(t, { justify: true })) : [inCell('')], { width: ACT_COL })
          ] })),
          signature('Assinatura do beneficiário:', 1),
          signature('De acordo (Coordenador do projeto):', 2)
        ]
      }),
      // Notes right below the table, in a smaller type so they share its page.
      ...TRAVEL_NOTES.map((t, i) => new Paragraph({ spacing: { before: i ? 0 : 60, after: 0, line: 220 }, keepLines: true,
        children: [...(i ? [] : [new TextRun({ text: 'Observações: ', bold: true, font: FONT, size: 18 })]), new TextRun({ text: t, font: FONT, size: 18 })] })),
      new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, spacing: { before: 0, after: 360 }, children: [new TextRun({ text: PHOTO_TITLE, bold: true, font: FONT, size: SIZE })] }),
      ...(fill.photos ?? []).flatMap((ph, i) => [
        new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 }, children: [new ImageRun({ type: 'jpg', data: ph.data, transformation: fit(ph.width, ph.height, 520, 330) })] }),
        para(photoCaption(i, ph.caption), { center: true, after: 200 })
      ]),
      para(''),
      ...(fill.signatures?.signers.length ? manifestDocx(fill.signatures, { font: FONT, size: SIZE, width: DATE_COL + ACT_COL }) : [])
    ] }]
  }));
}

export function travelPdf(b: TravelBeneficiary, fill: TravelFill = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 31, bottom: 50, left: 85, right: 81 } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const x = 85, w = doc.page.width - 85 - 81, bottom = doc.page.height - 50, FS = 10, LG = 2.4;
    const font = (bold = false) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FS);
    const text = (t: string, after = 10, o: { bold?: boolean; center?: boolean } = {}) => { font(o.bold).text(t, x, doc.y, { width: w, align: o.center ? 'center' : 'left', lineGap: LG }); doc.y += after; };
    const pair = (a: string, bText: string, at: number, after = 10) => { const y = doc.y; font().text(a, x, y, { lineBreak: false }); font().text(bText, x + at, y, { width: w - at, lineGap: LG }); doc.y = Math.max(doc.y, y + 12.4) + after; };

    const logoH = LOGO_PT * FAPTO_LOGO_SIZE.height / FAPTO_LOGO_SIZE.width;
    doc.image(FAPTO_LOGO_PNG, (doc.page.width - LOGO_PT) / 2, 31, { width: LOGO_PT }); doc.y = 31 + logoH + 9;
    text(TITLE, 14, { bold: true, center: true });
    text('FORMULÁRIO 26', 0, { bold: true, center: true }); text('RELATÓRIO DE VIAGEM', 14, { bold: true, center: true });
    text('IDENTIFICAÇÃO DO BENEFICIÁRIO', 13, { bold: true });
    text(`Nome do beneficiário: ${b.name}`);
    pair(`Contato telefônico: ${formatPhone(b.phone)}`, `E-mail: ${b.email}`, 207);
    font(true).text('Projeto/convênio:', x, doc.y, { width: w, continued: true, lineGap: LG }); font().text(` ${b.project}`, { lineGap: LG }); doc.y += 10;
    text(`Função no projeto/convênio: ${b.role}`);
    text('IDENTIFICAÇÃO DO AFASTAMENTO', 13, { bold: true });
    text(`Cidade/UF origem: ${fill.origin?.trim() || DEFAULT_ORIGIN}`, 0); text(`Cidade/UF destino: ${fill.destination?.trim() || DEFAULT_DESTINATION}`, 14);
    pair(`Saída: ${br(fill.departure)}`, `Retorno: ${br(fill.returnDate)}`, 134);
    const year = (fill.departure ?? '').slice(2, 4);
    text(`Data do pagamento da diária: ${fill.payment ? br(fill.payment) : year ? `____/____/${year}` : br(null)}`, 6);

    // Table: 434 pt wide, starting 5 pt left of the text margin, as in the model.
    const tx = x - 5, tw = w + 10, c1 = 84, pad = 5;
    let y = doc.y;
    const fits = (h: number) => { if (y + h > bottom) { doc.addPage(); y = 31; } };
    const box = (h: number, split = true) => { doc.lineWidth(.6).rect(tx, y, tw, h).stroke(); if (split) doc.moveTo(tx + c1, y).lineTo(tx + c1, y + h).stroke(); };
    // Header row spanning both columns.
    const instrH = font().heightOfString(INSTRUCTION, { width: tw - 2 * pad, align: 'center', lineGap: 0 });
    let h = 4 + 12 + instrH + 4; fits(h); box(h, false);
    font(true).text('DESCRIÇÃO DA VIAGEM', tx + pad, y + 4, { width: tw - 2 * pad, align: 'center' });
    font().text(INSTRUCTION, tx + pad, y + 16, { width: tw - 2 * pad, align: 'center' }); y += h;
    const objective = fill.objective?.trim();
    if (objective) {
      h = font().heightOfString(`Objetivo: ${objective}`, { width: tw - 2 * pad, align: 'justify', lineGap: 1 }) + 10; fits(h); box(h, false);
      font(true).text('Objetivo: ', tx + pad, y + 5, { width: tw - 2 * pad, continued: true, align: 'justify', lineGap: 1 }); font().text(objective, { align: 'justify', lineGap: 1 }); y += h;
    }
    const row = (a: string, c: string, min: number, atBottom = false, line = false) => {
      const ch = font().heightOfString(c || ' ', { width: tw - c1 - 2 * pad, lineGap: 1 });
      h = Math.max(min, ch + 10); fits(h); box(h);
      const ty = atBottom ? y + h - 17 : y + 3;
      font().text(a, tx + pad, ty, { width: c1 - 2 * pad }); font().text(c, tx + c1 + pad, ty, { width: tw - c1 - 2 * pad, align: atBottom ? 'left' : 'justify', lineGap: 1 });
      if (line) { const lx = tx + c1 + pad + font().widthOfString(`${c} `); doc.moveTo(lx, ty + 10).lineTo(tx + tw - 18, ty + 10).lineWidth(.8).stroke(); }
      y += h;
    };
    const entries = travelEntries(fill);
    row('Data', 'Atividades', 23);
    for (const [d, a] of entries) row(d, a, entries.length > 1 ? 21 : 52);
    const signRow = (label: string, step: number) => {
      const signed = fill.signatures?.signers.find((x) => x.step === step);
      if (!signed) return row('Data:', label, 52, true, true);
      h = 76; fits(h); box(h);
      font().text(`Data: ${signedDate(signed.signedAt)}`, tx + pad, y + h - 28, { width: c1 - 2 * pad });
      font().text(label, tx + c1 + pad, y + 5, { width: tw - c1 - 2 * pad });
      // Banknote-style seal: green for the beneficiary, gold for the coordination.
      sealPdf(doc, signed, { x: tx + c1 + pad, y: y + 16, width: tw - c1 - 2 * pad, regular: 'Helvetica', bold: 'Helvetica-Bold' });
      y += h;
    };
    signRow('Assinatura do beneficiário:', 1);
    signRow('De acordo (Coordenador do projeto):', 2);

    // The notes stay right below the table: they use the footer band of the page and, when
    // the table is long, a smaller type (down to 7.5 pt) instead of jumping to a page of their own.
    doc.y = y + 4;
    const notesBottom = doc.page.height - 24;
    const notesH = (size: number) => TRAVEL_NOTES.reduce((s, n, i) => s + doc.font('Helvetica').fontSize(size).heightOfString(i ? n : `Observações: ${n}`, { width: w, lineGap: .6 }), 0);
    const size = [FS, 9.5, 9, 8.5, 8, 7.5].find((s) => doc.y + notesH(s) <= notesBottom) ?? 7.5;
    const keepMargin = doc.page.margins.bottom; doc.page.margins.bottom = 24;
    doc.font('Helvetica-Bold').fontSize(size).text('Observações:', x, doc.y, { width: w, continued: true, lineGap: .6 }); doc.font('Helvetica').fontSize(size).text(` ${TRAVEL_NOTES[0]}`, { lineGap: .6 });
    for (const n of TRAVEL_NOTES.slice(1)) doc.font('Helvetica').fontSize(size).text(n, x, doc.y, { width: w, lineGap: .6 });
    doc.page.margins.bottom = keepMargin;

    doc.addPage(); doc.y = 31;
    font(true).text(PHOTO_TITLE, x, doc.y, { width: w, align: 'center' }); doc.y += 18;
    (fill.photos ?? []).forEach((ph, i) => {
      const caption = photoCaption(i, ph.caption);
      const size = fit(ph.width, ph.height, w, 250), capH = font().heightOfString(caption, { width: w });
      if (doc.y + size.height + capH + 16 > bottom) { doc.addPage(); doc.y = 31; }
      doc.image(ph.data, x + (w - size.width) / 2, doc.y, size); doc.y += size.height + 4;
      font().text(caption, x, doc.y, { width: w, align: 'center' });
      doc.y += 12;
    });
    if (fill.signatures?.signers.length) manifestPdf(doc, fill.signatures, { x, width: w, top: 31, regular: 'Helvetica', bold: 'Helvetica-Bold' });
    doc.end();
  });
}
