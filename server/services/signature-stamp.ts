import { AlignmentType, BorderStyle, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType } from 'docx';

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
