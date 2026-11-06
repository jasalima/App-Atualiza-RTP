import { LEGAL_BASIS, LEGAL_EVIDENCE, LEGAL_TITLE } from '../../lib/legal';
import { AlignmentType, BorderStyle, ImageRun, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType } from 'docx';
import { SEAL_EMBLEM_GOLD, SEAL_EMBLEM_GREEN } from '../assets/seal-emblems';
import qrcode from 'qrcode-generator';

/** Electronic signatures collected for a document, printed on its last page. */
export type SignedBy = { step: number; name: string; roleLabel: string; cpf: string; signedAt: string; ip: string; signatureHash: string };
export type SignatureManifest = { label: string; status: 'pending' | 'completed'; documentHash: string; verificationCode: string | null; verifyUrl: string | null; signers: SignedBy[] };

const TZ = 'America/Sao_Paulo';
export const signedDate = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
export const signedTime = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));
/** CPF shown as on gov.br signatures: ***.456.789-** */
export const maskCpf = (cpf: string) => { const d = cpf.replace(/\D/g, ''); return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : '***'; };
export const stampLine = (s: SignedBy) => `Assinado eletronicamente por ${s.name} em ${signedDate(s.signedAt)} às ${signedTime(s.signedAt)}`;

export const MANIFEST_TITLE = 'MANIFESTO DE ASSINATURAS ELETRÔNICAS';
export const LEGAL_NOTE = `${LEGAL_BASIS} ${LEGAL_EVIDENCE}`;
const facts = (m: SignatureManifest) => [
  ['Documento', m.label],
  ['Situação', m.status === 'completed' ? 'Assinaturas concluídas' : 'Assinaturas em andamento'],
  ['Hash do documento (SHA-256)', m.documentHash],
  ...(m.verificationCode ? [['Código de verificação', m.verificationCode]] : []),
  ...(m.verifyUrl ? [['Verificação', m.verifyUrl]] : [])
] as Array<[string, string]>;
const signerRows = (s: SignedBy): Array<[string, string]> => [
  ['Signatário', `${s.name}${s.roleLabel ? ` — ${s.roleLabel}` : ''}`],
  ['CPF', maskCpf(s.cpf)],
  ['Data e hora', `${signedDate(s.signedAt)} às ${signedTime(s.signedAt)} (horário de Brasília)`],
  ['Endereço IP', s.ip || 'não informado'],
  ['Hash da assinatura', s.signatureHash]
];

/** DOCX blocks of the manifest page (starts on a new page). */
export function manifestDocx(m: SignatureManifest, o: { font: string; size: number; width: number }) {
  const run = (text: string, bold = false, size = o.size - 2) => new TextRun({ text, bold, font: o.font, size });
  const p = (children: TextRun[], extra: { center?: boolean; after?: number; pageBreak?: boolean } = {}) => new Paragraph({ pageBreakBefore: extra.pageBreak, alignment: extra.center ? AlignmentType.CENTER : AlignmentType.JUSTIFIED, spacing: { before: 0, after: extra.after ?? 120 }, children });
  const border = { style: BorderStyle.SINGLE, size: 4, color: '7F7F7F' };
  const table = (rows: Array<[string, string]>) => new Table({
    width: { size: o.width, type: WidthType.DXA }, columnWidths: [Math.round(o.width * 0.3), o.width - Math.round(o.width * 0.3)], layout: TableLayoutType.FIXED,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map(([k, v]) => new TableRow({ cantSplit: true, children: [
      new TableCell({ width: { size: Math.round(o.width * 0.3), type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 100, right: 100 }, children: [p([run(k, true)], { after: 0 })] }),
      new TableCell({ width: { size: o.width - Math.round(o.width * 0.3), type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 100, right: 100 }, children: [new Paragraph({ children: [run(v)] })] })
    ] }))
  });
  return [
    p([run(MANIFEST_TITLE, true, o.size)], { center: true, after: 240, pageBreak: true }),
    table(facts(m)),
    p([], { after: 120 }),
    ...m.signers.flatMap((s) => [p([run(`${s.step}. ${stampLine(s)}`, true)], { after: 60 }), table(signerRows(s)), p([], { after: 120 })]),
    p([run(LEGAL_TITLE, true)], { after: 60 }),
    p([run(LEGAL_BASIS)], { after: 60 }),
    p([run(LEGAL_EVIDENCE)], { after: 0 })
  ];
}

/** PDFKit manifest page. */
export function manifestPdf(doc: PDFKit.PDFDocument, m: SignatureManifest, o: { x: number; width: number; top: number; regular: string; bold: string }) {
  doc.addPage(); doc.y = o.top;
  doc.font(o.bold).fontSize(11).fillColor('black').text(MANIFEST_TITLE, o.x, doc.y, { width: o.width, align: 'center' }); doc.y += 14;
  const k = Math.round(o.width * 0.3);
  const table = (rows: Array<[string, string]>) => {
    for (const [a, b] of rows) {
      const h = Math.max(doc.font(o.bold).fontSize(9).heightOfString(a, { width: k - 10 }), doc.font(o.regular).fontSize(9).heightOfString(b, { width: o.width - k - 10 })) + 8;
      if (doc.y + h > doc.page.height - 50) { doc.addPage(); doc.y = o.top; }
      const y = doc.y;
      doc.lineWidth(.5).strokeColor('#7f7f7f').rect(o.x, y, k, h).stroke().rect(o.x + k, y, o.width - k, h).stroke();
      doc.fillColor('black').font(o.bold).fontSize(9).text(a, o.x + 5, y + 4, { width: k - 10 });
      doc.font(o.regular).fontSize(9).text(b, o.x + k + 5, y + 4, { width: o.width - k - 10 });
      doc.y = y + h;
    }
    doc.y += 10;
  };
  table(facts(m));
  for (const s of m.signers) {
    doc.font(o.bold).fontSize(9.5).text(`${s.step}. ${stampLine(s)}`, o.x, doc.y, { width: o.width }); doc.y += 4;
    table(signerRows(s));
  }
  if (doc.y + 90 > doc.page.height - 50) { doc.addPage(); doc.y = o.top; }
  doc.font(o.bold).fontSize(9).fillColor('black').text(LEGAL_TITLE, o.x, doc.y + 4, { width: o.width });
  doc.font(o.regular).fontSize(8.5).text(LEGAL_BASIS, o.x, doc.y + 3, { width: o.width, align: 'justify' });
  doc.text(LEGAL_EVIDENCE, o.x, doc.y + 3, { width: o.width, align: 'justify' });
}

/* Compact signature block printed on each signature field -------------------------------------- */
// In the style of the gov.br signature: a small emblem and four short lines, on a faint
// banknote-style ground. Green for the beneficiary (first signer), gold for the coordination.
// Full details stay on the manifest page.
const SEAL = {
  member: { dark: '1F6B45', mid: '2E8B57', light: 'F3F9F5', emblem: SEAL_EMBLEM_GREEN },
  coordination: { dark: '8A6508', mid: 'C79A12', light: 'FDF8EA', emblem: SEAL_EMBLEM_GOLD }
} as const;
export const sealTone = (s: SignedBy) => SEAL[s.step === 1 ? 'member' : 'coordination'];
/** Brazil has no daylight saving time since 2019: Brasília is always UTC-3. */
export const sealLines = (s: SignedBy, verifyUrl?: string | null) => ({
  title: 'Documento assinado eletronicamente',
  name: s.name.toLocaleUpperCase('pt-BR'),
  when: `Data: ${signedDate(s.signedAt)} ${signedTime(s.signedAt)}-0300${s.ip ? ` · IP ${s.ip}` : ''}`,
  check: verifyUrl ? `Verifique em ${verifyUrl.replace(/^https?:\/\//, '')}` : `Hash ${s.signatureHash.slice(0, 24)}…`
});
/** Widest the block gets: about 7.5 cm, as a signature stamp. */
export const SEAL_MAX_PT = 215;
/** Height of the PDF block. */
export const SEAL_H_PT = 36;

/** DOCX block: emblem and four lines on a light tint with a thin frame; right-aligned in the cell when asked. */
export function sealDocx(s: SignedBy, o: { font: string; width: number; verifyUrl?: string | null; align?: 'left' | 'center' | 'right' }) {
  const t = sealTone(s), l = sealLines(s, o.verifyUrl), width = Math.min(o.width, SEAL_MAX_PT * 20), emblemCol = 620, textCol = width - emblemCol;
  const frame = { style: BorderStyle.SINGLE, size: 4, color: t.mid }, none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const shading = { fill: t.light, type: ShadingType.CLEAR, color: 'auto' };
  const run = (text: string, opts: { bold?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, bold: opts.bold, size: opts.size ?? 11, color: opts.color ?? '333333', font: o.font });
  const line = (children: TextRun[]) => new Paragraph({ spacing: { before: 0, after: 0, line: 190 }, children });
  return new Table({
    width: { size: width, type: WidthType.DXA }, columnWidths: [emblemCol, textCol], layout: TableLayoutType.FIXED,
    alignment: o.align === 'right' ? AlignmentType.RIGHT : o.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
    borders: { top: frame, bottom: frame, left: frame, right: frame, insideHorizontal: none, insideVertical: none },
    rows: [new TableRow({ cantSplit: true, children: [
      new TableCell({ width: { size: emblemCol, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, shading, margins: { top: 60, bottom: 60, left: 80, right: 40 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: t.emblem, transformation: { width: 28, height: 28 } })] })] }),
      new TableCell({ width: { size: textCol, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, shading, margins: { top: 60, bottom: 60, left: 40, right: 100 },
        children: [
          line([run(l.title, { bold: true, size: 11, color: t.dark })]),
          line([run(l.name, { bold: true, size: 14, color: '111111' })]),
          line([run(l.when)]),
          line([run(l.check, { size: 10 })])
        ] })
    ] })]
  });
}

/** PDF block: emblem and four lines on a faint guilloché ground, about 7.5 × 1.3 cm. Returns its height. */
export function sealPdf(doc: PDFKit.PDFDocument, s: SignedBy, o: { x: number; y: number; width: number; regular: string; bold: string; verifyUrl?: string | null; align?: 'left' | 'right' }) {
  const t = sealTone(s), l = sealLines(s, o.verifyUrl), w = Math.min(o.width, SEAL_MAX_PT), h = SEAL_H_PT, e = 22, pad = 5;
  const x = o.align === 'right' ? o.x + o.width - w : o.x, y = o.y, tx = x + pad + e + 5, tw = w - (tx - x) - pad;
  doc.save();
  doc.roundedRect(x, y, w, h, 3).fill(`#${t.light}`);
  // Banknote ground: interlaced sine waves, very faint, clipped to the block.
  doc.save(); doc.roundedRect(x, y, w, h, 3).clip();
  for (let k = 0; k < 9; k++) {
    const base = y + 2 + k * 4.2, amp = 1.6 + (k % 3) * 0.7, period = 22 + (k % 4) * 6, phase = k * 1.1;
    doc.moveTo(x, base);
    for (let px = 0; px <= w; px += 2) doc.lineTo(x + px, base + amp * Math.sin(px / period * 2 * Math.PI + phase));
    doc.lineWidth(0.3).strokeOpacity(0.13).stroke(`#${t.mid}`);
  }
  doc.restore();
  doc.strokeOpacity(0.55).lineWidth(0.5).strokeColor(`#${t.mid}`).roundedRect(x, y, w, h, 3).stroke().strokeOpacity(1);
  doc.image(t.emblem, x + pad, y + (h - e) / 2, { width: e, height: e });
  doc.font(o.bold).fontSize(5.8).fillColor(`#${t.dark}`).text(l.title, tx, y + 3.6, { width: tw, lineBreak: false });
  // A long name shrinks instead of wrapping.
  let size = 7.6; while (size > 5.6 && doc.font(o.bold).fontSize(size).widthOfString(l.name) > tw) size -= 0.2;
  doc.font(o.bold).fontSize(size).fillColor('#111111').text(l.name, tx, y + 11, { width: tw, lineBreak: false });
  doc.font(o.regular).fontSize(5.8).fillColor('#333333').text(l.when, tx, y + 19.8, { width: tw, lineBreak: false });
  doc.font(o.regular).fontSize(5.3).fillColor('#555555').text(l.check, tx, y + 27, { width: tw, lineBreak: false });
  doc.restore(); doc.fillColor('black').strokeColor('black');
  return h;
}

/* Authenticity block: QR code to the public verification and the legal basis -------------------- */
// Printed right below the signatures once everyone has signed (the verification code exists only then).
const AUTH_TITLE = 'AUTENTICIDADE DO DOCUMENTO';
const authLines = (m: SignatureManifest) => ({ url: m.verifyUrl!, code: m.verificationCode!, legal: LEGAL_BASIS });
export const hasAuthenticity = (m?: SignatureManifest | null): m is SignatureManifest => !!m?.verifyUrl && !!m.verificationCode && m.status === 'completed';

/** QR matrix drawn as vector squares, with a one-module quiet zone. */
function drawQrPdf(doc: PDFKit.PDFDocument, text: string, x: number, y: number, size: number) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), cell = size / (n + 2);
  doc.save().rect(x, y, size, size).fill('#FFFFFF');
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) doc.rect(x + (c + 1) * cell, y + (r + 1) * cell, cell + 0.02, cell + 0.02);
  doc.fill('#000000').restore();
}

/** PDF: QR code on the left; title, where to verify, the code and the legal basis on the right. Returns its height. */
export function authenticityPdf(doc: PDFKit.PDFDocument, m: SignatureManifest, o: { x: number; y: number; width: number; regular: string; bold: string }) {
  const l = authLines(m), qr = 58, tx = o.x + qr + 12, tw = o.width - qr - 18;
  const legalH = doc.font(o.regular).fontSize(6.3).heightOfString(`Amparo legal: ${l.legal}`, { width: tw, lineGap: 0.4 });
  const h = Math.max(qr + 8, 8 + 9 + 8.5 + 8.5 + legalH + 6), { x, y } = o;
  doc.save();
  doc.lineWidth(0.5).strokeColor('#9A9A9A').rect(x, y, o.width, h).stroke();
  drawQrPdf(doc, l.url, x + 4, y + (h - qr) / 2, qr);
  let ty = y + 5;
  doc.font(o.bold).fontSize(7.6).fillColor('#000000').text(AUTH_TITLE, tx, ty, { width: tw, lineBreak: false }); ty += 9;
  const lead = 'Confira pelo QR Code ao lado ou em ', leadW = doc.font(o.regular).fontSize(6.8).widthOfString(lead);
  doc.text(lead, tx, ty, { width: tw, lineBreak: false });
  doc.fillColor('#0B4F8A').text(l.url.replace(/^https?:\/\//, ''), tx + leadW, ty, { width: tw - leadW, link: l.url, underline: true, lineBreak: false }); ty += 8.5;
  doc.fillColor('#000000').font(o.regular).fontSize(6.8).text('Código de verificação: ', tx, ty, { width: tw, continued: true }).font(o.bold).text(l.code); ty += 8.5;
  doc.font(o.bold).fontSize(6.3).text('Amparo legal: ', tx, ty, { width: tw, continued: true, lineGap: 0.4, align: 'justify' }).font(o.regular).text(l.legal, { lineGap: 0.4, align: 'justify' });
  doc.restore(); doc.fillColor('black').strokeColor('black');
  return h;
}

/** DOCX: the same block as a two-column table with a thin frame (QR as a GIF image). */
export function authenticityDocx(m: SignatureManifest, o: { font: string; width: number }) {
  const l = authLines(m), qrCol = 1500, textCol = o.width - qrCol;
  const qr = qrcode(0, 'M'); qr.addData(l.url); qr.make();
  const gif = Buffer.from(qr.createDataURL(4, 4).split(',')[1], 'base64');
  const frame = { style: BorderStyle.SINGLE, size: 4, color: '9A9A9A' }, none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const run = (text: string, opts: { bold?: boolean; size?: number; color?: string; underline?: boolean } = {}) => new TextRun({ text, bold: opts.bold, size: opts.size ?? 14, color: opts.color ?? '000000', font: o.font, underline: opts.underline ? {} : undefined });
  const line = (children: TextRun[], justify = false) => new Paragraph({ alignment: justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT, spacing: { before: 0, after: 20, line: 200 }, children });
  return new Table({
    width: { size: o.width, type: WidthType.DXA }, columnWidths: [qrCol, textCol], layout: TableLayoutType.FIXED,
    borders: { top: frame, bottom: frame, left: frame, right: frame, insideHorizontal: none, insideVertical: none },
    rows: [new TableRow({ cantSplit: true, children: [
      new TableCell({ width: { size: qrCol, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { top: 60, bottom: 60, left: 80, right: 40 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'gif', data: gif, transformation: { width: 76, height: 76 } })] })] }),
      new TableCell({ width: { size: textCol, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { top: 60, bottom: 60, left: 80, right: 100 },
        children: [
          line([run(AUTH_TITLE, { bold: true, size: 15 })]),
          line([run('Confira pelo QR Code ao lado ou em '), run(l.url.replace(/^https?:\/\//, ''), { color: '0B4F8A', underline: true })]),
          line([run('Código de verificação: '), run(l.code, { bold: true })]),
          line([run('Amparo legal: ', { bold: true, size: 13 }), run(l.legal, { size: 13 })], true)
        ] })
    ] })]
  });
}
