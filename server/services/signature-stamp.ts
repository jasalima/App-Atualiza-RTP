import { LEGAL_BASIS, LEGAL_EVIDENCE, LEGAL_TITLE } from '../../lib/legal';
import { AlignmentType, BorderStyle, ImageRun, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType } from 'docx';
import { SEAL_EMBLEM_GOLD, SEAL_EMBLEM_GREEN } from '../assets/seal-emblems';

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
// In the style of the gov.br signature: a small emblem and four short lines. Green for the
// beneficiary (first signer), gold for the coordination. Full details stay on the manifest page.
const SEAL = {
  member: { dark: '1F6B45', emblem: SEAL_EMBLEM_GREEN },
  coordination: { dark: '8A6508', emblem: SEAL_EMBLEM_GOLD }
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

/** DOCX block: emblem cell and four lines, no frame. */
export function sealDocx(s: SignedBy, o: { font: string; width: number; verifyUrl?: string | null }) {
  const t = sealTone(s), l = sealLines(s, o.verifyUrl), width = Math.min(o.width, SEAL_MAX_PT * 20), emblemCol = 560, textCol = width - emblemCol;
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const run = (text: string, opts: { bold?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, bold: opts.bold, size: opts.size ?? 11, color: opts.color ?? '333333', font: o.font });
  const line = (children: TextRun[]) => new Paragraph({ spacing: { before: 0, after: 0, line: 190 }, children });
  return new Table({
    width: { size: width, type: WidthType.DXA }, columnWidths: [emblemCol, textCol], layout: TableLayoutType.FIXED,
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: [new TableRow({ cantSplit: true, children: [
      new TableCell({ width: { size: emblemCol, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 0, right: 60 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: t.emblem, transformation: { width: 30, height: 30 } })] })] }),
      new TableCell({ width: { size: textCol, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 0, right: 0 },
        children: [
          line([run(l.title, { bold: true, size: 11, color: t.dark })]),
          line([run(l.name, { bold: true, size: 14, color: '111111' })]),
          line([run(l.when)]),
          line([run(l.check, { size: 10 })])
        ] })
    ] })]
  });
}

/** PDF block: emblem and four lines, about 7.5 × 1.2 cm. Returns its height. */
export function sealPdf(doc: PDFKit.PDFDocument, s: SignedBy, o: { x: number; y: number; width: number; regular: string; bold: string; verifyUrl?: string | null }) {
  const t = sealTone(s), l = sealLines(s, o.verifyUrl), w = Math.min(o.width, SEAL_MAX_PT), h = 32, e = 24;
  const { x, y } = o, tx = x + e + 6, tw = w - e - 6;
  doc.save();
  doc.image(t.emblem, x, y + (h - e) / 2, { width: e, height: e });
  doc.font(o.bold).fontSize(5.8).fillColor(`#${t.dark}`).text(l.title, tx, y + 1, { width: tw, lineBreak: false });
  // A long name shrinks instead of wrapping.
  let size = 7.6; while (size > 5.6 && doc.font(o.bold).fontSize(size).widthOfString(l.name) > tw) size -= 0.2;
  doc.font(o.bold).fontSize(size).fillColor('#111111').text(l.name, tx, y + 8.4, { width: tw, lineBreak: false });
  doc.font(o.regular).fontSize(5.8).fillColor('#333333').text(l.when, tx, y + 17.2, { width: tw, lineBreak: false });
  doc.font(o.regular).fontSize(5.3).fillColor('#555555').text(l.check, tx, y + 24.4, { width: tw, lineBreak: false });
  doc.restore(); doc.fillColor('black').strokeColor('black');
  return h;
}
