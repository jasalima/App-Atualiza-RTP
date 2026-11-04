import { AlignmentType, BorderStyle, ImageRun, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType } from 'docx';
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
export const LEGAL_NOTE = 'Documento assinado eletronicamente nos termos da Lei nº 14.063/2020, com identificação do signatário por conta pessoal de acesso, CPF, data, hora e endereço IP. A integridade é garantida pelo resumo criptográfico SHA-256 do conteúdo: qualquer alteração posterior invalida as assinaturas.';
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
    p([run(LEGAL_NOTE)], { after: 0 })
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
  doc.font(o.regular).fontSize(8.5).text(LEGAL_NOTE, o.x, doc.y, { width: o.width, align: 'justify' });
}

/* Banknote-style seal printed on each signature field ------------------------------------------ */
// Green for the beneficiary (first signer), gold for the coordination (the following ones).
const SEAL = {
  member: { role: 'BENEFICIÁRIO', dark: '1F6B45', mid: '2E8B57', light: 'EEF7F1', emblem: SEAL_EMBLEM_GREEN },
  coordination: { role: 'COORDENAÇÃO DO PROJETO', dark: '8A6508', mid: 'C79A12', light: 'FCF6E3', emblem: SEAL_EMBLEM_GOLD }
} as const;
export const sealTone = (s: SignedBy) => SEAL[s.step === 1 ? 'member' : 'coordination'];
/** The audit lines of the seal; the signing date and time follow the signer's name. */
export const sealLines = (s: SignedBy) => ({
  title: 'ASSINADO ELETRONICAMENTE POR:',
  name: s.name.toLocaleUpperCase('pt-BR'),
  when: `${signedDate(s.signedAt)} às ${signedTime(s.signedAt)}`,
  hash: `Hash: ${s.signatureHash}`,
  ip: `IP da máquina: ${s.ip || 'não informado'} · horário de Brasília`
});
const microtext = (role: string, n: number) => Array.from({ length: n }, () => `${role} • ASSINATURA ELETRÔNICA • LEI 14.063/2020 • SHA-256 • `).join('');

/** DOCX seal: a table with double frame, microtext bands, the emblem and the audit lines. */
export function sealDocx(s: SignedBy, o: { font: string; width: number }) {
  const t = sealTone(s), l = sealLines(s), emblemCol = 980, textCol = o.width - emblemCol;
  const frame = { style: BorderStyle.DOUBLE, size: 6, color: t.dark }, none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const run = (text: string, opts: { bold?: boolean; size?: number; color?: string; font?: string } = {}) => new TextRun({ text, bold: opts.bold, size: opts.size ?? 16, color: opts.color ?? '1A1A1A', font: opts.font ?? o.font });
  const line = (children: TextRun[], after = 0) => new Paragraph({ spacing: { before: 0, after, line: 200 }, children });
  const band = (text: string, fill: string, color: string) => new TableRow({ cantSplit: true, children: [new TableCell({
    columnSpan: 2, shading: { fill, type: ShadingType.CLEAR, color: 'auto' }, margins: { top: 10, bottom: 10, left: 80, right: 80 },
    children: [new Paragraph({ spacing: { before: 0, after: 0, line: 120 }, children: [new TextRun({ text, size: 8, color, font: 'Arial', characterSpacing: 4 })] })]
  })] });
  return new Table({
    width: { size: o.width, type: WidthType.DXA }, columnWidths: [emblemCol, textCol], layout: TableLayoutType.FIXED,
    borders: { top: frame, bottom: frame, left: frame, right: frame, insideHorizontal: none, insideVertical: none },
    rows: [
      // Microtext must stay on one line: about one character per 60 twips at 4 pt.
      band(`${t.role} • ${microtext(t.role, 3)}`.slice(0, Math.floor(o.width / 62)), t.dark, 'FFFFFF'),
      new TableRow({ cantSplit: true, children: [
        new TableCell({ width: { size: emblemCol, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, shading: { fill: t.light, type: ShadingType.CLEAR, color: 'auto' }, margins: { top: 20, bottom: 20, left: 70, right: 30 },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: t.emblem, transformation: { width: 42, height: 42 } })] })] }),
        new TableCell({ width: { size: textCol, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, shading: { fill: t.light, type: ShadingType.CLEAR, color: 'auto' }, margins: { top: 20, bottom: 20, left: 50, right: 100 },
          children: [
            line([run(l.title, { bold: true, size: 13, color: t.dark })]),
            line([run(l.name, { bold: true, size: 17, color: '111111' }), run(`  ·  ${l.when}`, { size: 15, color: t.dark })], 10),
            line([run(l.hash, { size: 12, font: 'Consolas', color: '333333' })]),
            line([run(l.ip, { size: 13 })])
          ] })
      ] }),
      band(microtext('RTP INTELIGENTE', 4).slice(0, Math.floor(o.width / 56)), t.light, t.mid)
    ]
  });
}

/** PDF seal drawn as vectors (guilloché, double frame, microtext). Returns its height. */
export function sealPdf(doc: PDFKit.PDFDocument, s: SignedBy, o: { x: number; y: number; width: number; regular: string; bold: string }) {
  const t = sealTone(s), l = sealLines(s), { x, y, width: w } = o, h = 56, band = 7;
  doc.save();
  doc.roundedRect(x, y, w, h, 4).fill(`#${t.light}`);
  // Guilloché: interlaced sine waves clipped to the seal, as on banknotes.
  doc.save(); doc.roundedRect(x, y, w, h, 4).clip();
  for (let k = 0; k < 10; k++) {
    const base = y + band + 5 + k * 4.4, amp = 2.2 + (k % 3), period = 26 + (k % 4) * 7, phase = k * 1.3;
    doc.moveTo(x, base);
    for (let px = 0; px <= w; px += 2) doc.lineTo(x + px, base + amp * Math.sin(px / period * 2 * Math.PI + phase));
    doc.lineWidth(0.35).strokeOpacity(0.22).stroke(`#${t.mid}`);
  }
  doc.restore();
  doc.strokeOpacity(1);
  // Microtext bands.
  doc.rect(x, y, w, band).fill(`#${t.dark}`);
  doc.font(o.regular).fontSize(4.6).fillColor('#ffffff').text(`${t.role} • ${microtext(t.role, 4)}`, x + 4, y + 1.8, { width: w - 8, height: 6, lineBreak: false, characterSpacing: 0.4 });
  doc.font(o.regular).fontSize(3.6).fillColor(`#${t.mid}`).text(microtext('RTP INTELIGENTE', 6), x + 4, y + h - 6, { width: w - 8, height: 5, lineBreak: false });
  // Double frame.
  doc.lineWidth(1.1).strokeColor(`#${t.dark}`).roundedRect(x, y, w, h, 4).stroke();
  doc.lineWidth(0.4).roundedRect(x + 2.2, y + 2.2, w - 4.4, h - 4.4, 3).stroke();
  // Emblem and the audit lines (name followed by the signing date and time).
  const e = 36; doc.image(t.emblem, x + 8, y + band + (h - band - e) / 2 - 2, { width: e, height: e });
  const tx = x + e + 15, tw = w - e - 23; let ty = y + band + 4;
  doc.font(o.bold).fontSize(6).fillColor(`#${t.dark}`).text(l.title, tx, ty, { width: tw, lineBreak: false, characterSpacing: 0.3 }); ty += 7.6;
  // Shrink a long name so the name and the date always share one line.
  const when = `  ·  ${l.when}`, whenW = doc.font(o.regular).fontSize(7).widthOfString(when);
  let size = 8.6; while (size > 6 && doc.font(o.bold).fontSize(size).widthOfString(l.name) + whenW > tw) size -= 0.2;
  doc.font(o.bold).fontSize(size).fillColor('#111111').text(l.name, tx, ty, { lineBreak: false, continued: true });
  doc.font(o.regular).fontSize(7).fillColor(`#${t.dark}`).text(when, { lineBreak: false }); ty += 10.4;
  doc.font('Courier').fontSize(5.2).fillColor('#333333').text(l.hash, tx, ty, { width: tw, lineBreak: false }); ty += 7.6;
  doc.font(o.regular).fontSize(6).fillColor('#1a1a1a').text(l.ip, tx, ty, { width: tw, lineBreak: false });
  doc.restore(); doc.fillColor('black').strokeColor('black');
  return h;
}
