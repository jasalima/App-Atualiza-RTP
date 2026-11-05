import PDFDocument from 'pdfkit';
import qrcode from 'qrcode-generator';
import { LOGO_PAJE, LOGO_POLO, LOGO_UFT } from '../assets/minutes-logos';
import { ATTENDANCE_LABEL, dateLong, dateShort, numberTopics, timeText, type MinuteContent, type RichDoc, type RichNode } from '../../lib/minutes-model';

// Ata de reunião in the institutional model (Ata_Reuniao_Produto_1.3): UFT / Polo / PAJE header,
// orange title band, justified body, SEI-like signature blocks with the RTP seal, authenticity
// block with QR Code, annexes after the signatures and "Página N de M" on every page.

export type MinuteSignature = { name: string; roleLabel: string; signedAt: string; signatureHash: string };
export type MinutePdfOptions = {
  draft: boolean;                       // preview of an unfinished ata: watermark and no code
  version?: number; code?: string; verifyUrl?: string; contentHash?: string; issuedAt?: string;
  signatures: MinuteSignature[]; totalSigners: number;
  images: Map<string, Buffer>;           // storage key -> image bytes (JPEG/PNG)
  createdAt?: Date;                     // fixed metadata date: the same state yields the same file
};

const PAGE = { w: 595.28, h: 841.89 }, LEFT = 57, RIGHT = 57, TOP = 112, BOTTOM = 62, WIDTH = PAGE.w - LEFT - RIGHT;
const SIZE = 10.5, GAP = 1.6, PARA = 6;
const ORANGE = '#F6A821', ORANGE_DARK = '#7A3E00', GRAY = '#555555', RULE = '#8C8C8C';
const fontOf = (bold: boolean, italic: boolean) => bold ? (italic ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : italic ? 'Helvetica-Oblique' : 'Helvetica';

// Standard PDF fonts cover WinAnsi only: common symbols are spelled out, the rest dropped.
const SWAP: Record<string, string> = { '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '≠': '!=', '✓': 'v', '✔': 'v', '−': '-', ' ': ' ', '\t': '    ' };
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export const pdfSafe = (t: string) => Array.from(t ?? '').map((c) => SWAP[c] ?? ((c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 255) || c === '\n' || WINANSI_EXTRA.includes(c) ? c : '')).join('');

type Run = { text: string; bold: boolean; italic: boolean; underline: boolean };
function runsOf(nodes: RichNode[] = [], inherited: Partial<Run> = {}): Run[] {
  const out: Run[] = [];
  for (const n of nodes) {
    if (n.type === 'hardBreak') { out.push({ text: '\n', bold: false, italic: false, underline: false }); continue; }
    if (n.type !== 'text' || !n.text) { if (n.content) out.push(...runsOf(n.content, inherited)); continue; }
    const marks = new Set((n.marks ?? []).map((m) => m.type));
    out.push({ text: pdfSafe(n.text), bold: marks.has('bold') || !!inherited.bold, italic: marks.has('italic') || !!inherited.italic, underline: marks.has('underline') || !!inherited.underline });
  }
  return out.filter((r) => r.text);
}

export function minutesPdf(c: MinuteContent, o: MinutePdfOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margins: { top: TOP, bottom: BOTTOM, left: LEFT, right: RIGHT }, bufferPages: true,
      info: { Title: pdfSafe(`${c.number} — ${c.subject || c.title}`), Author: 'RTP Inteligente', Subject: pdfSafe(c.projectTitle), Keywords: o.code ? `RTP-VERIFICACAO:${o.code}` : 'RTP-MINUTA', CreationDate: o.createdAt ?? new Date() }
    });
    const chunks: Buffer[] = []; doc.on('data', (b) => chunks.push(b)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    try { body(doc, c, o); decorate(doc, c, o); doc.end(); } catch (error) { reject(error); }
  });
}

/* Layout helpers ------------------------------------------------------------------------------ */
const bottomY = (doc: PDFKit.PDFDocument) => doc.page.height - doc.page.margins.bottom;
function need(doc: PDFKit.PDFDocument, h: number) { if (doc.y + h > bottomY(doc)) doc.addPage(); }

// Rich paragraphs are laid out word by word: pdfkit's own justification breaks when the
// font changes inside a line (bold names in the opening paragraph).
type Token = { text: string; run: Run; space: boolean; width: number } | { br: true };
function tokens(doc: PDFKit.PDFDocument, runs: Run[], size: number): Token[] {
  const out: Token[] = [];
  for (const run of runs) {
    doc.font(fontOf(run.bold, run.italic)).fontSize(size);
    run.text.split(/(\n| +)/).forEach((piece) => {
      if (!piece) return;
      if (piece === '\n') { out.push({ br: true }); return; }
      const space = /^ +$/.test(piece);
      out.push({ text: space ? ' ' : piece, run, space, width: doc.widthOfString(space ? ' ' : piece) });
    });
  }
  return out;
}
/** Draws a paragraph with mixed bold/italic/underline; returns the height used. */
export function richText(doc: PDFKit.PDFDocument, runs: Run[], o: { x: number; width: number; align?: string; size?: number; lineGap?: number; keep?: boolean }) {
  const size = o.size ?? SIZE, align = o.align ?? 'justify', lineH = size * 1.16 + (o.lineGap ?? GAP);
  const lines: Array<{ items: Array<Extract<Token, { text: string }>>; last: boolean }> = [];
  let line: Array<Extract<Token, { text: string }>> = [], width = 0;
  const flush = (last: boolean) => { while (line.length && line[line.length - 1].space) line.pop(); lines.push({ items: line, last }); line = []; width = 0; };
  // Words may span styles ("CONSALES" + "." or "APROEST" + ","): lines break only at spaces.
  let word: Array<Extract<Token, { text: string }>> = [];
  const place = () => {
    if (!word.length) return;
    const ww = word.reduce((a, t) => a + t.width, 0);
    if (width + ww > o.width && line.length) flush(false);
    if (ww > o.width) { // a word longer than the line (links): split by characters
      for (const t of word) {
        doc.font(fontOf(t.run.bold, t.run.italic)).fontSize(size);
        let chunk = '';
        for (const ch of t.text) { if (doc.widthOfString(chunk + ch) > o.width - width && chunk) { line.push({ ...t, text: chunk, width: doc.widthOfString(chunk) }); flush(false); chunk = ''; } chunk += ch; }
        if (chunk) { const w = doc.widthOfString(chunk); line.push({ ...t, text: chunk, width: w }); width += w; }
      }
    } else { line.push(...word); width += ww; }
    word = [];
  };
  for (const t of tokens(doc, runs, size)) {
    if ('br' in t) { place(); flush(true); continue; }
    if (!t.space) { word.push(t); continue; }
    place();
    if (line.length) { line.push(t); width += t.width; }
  }
  place();
  if (line.length || !lines.length) flush(true);
  const start = doc.y;
  if (o.keep && doc.y + lines.length * lineH > bottomY(doc)) doc.addPage();
  for (const l of lines) {
    if (doc.y + lineH > bottomY(doc) + GAP) doc.addPage();
    const natural = l.items.reduce((a, t) => a + t.width, 0), gaps = l.items.filter((t) => t.space).length;
    const extra = o.width - natural;
    let x = o.x + (align === 'center' ? extra / 2 : align === 'right' ? extra : 0);
    const stretch = align === 'justify' && !l.last && gaps ? extra / gaps : 0;
    const y = doc.y;
    // One text operation per style segment, with real spaces (copy, search and screen readers keep
    // the words apart); justification widens those spaces through wordSpacing.
    const segments: Array<{ run: Run; text: string; width: number; spaces: number }> = [];
    for (const t of l.items) {
      const last = segments[segments.length - 1];
      // A space never opens a segment (pdfkit drops leading spaces): it closes the previous one.
      if (last && (last.run === t.run || t.space)) { last.text += t.text; last.width += t.width; last.spaces += t.space ? 1 : 0; }
      else segments.push({ run: t.run, text: t.text, width: t.width, spaces: t.space ? 1 : 0 });
    }
    for (const s of segments) {
      const w = s.width + s.spaces * stretch;
      doc.font(fontOf(s.run.bold, s.run.italic)).fontSize(size).fillColor('#000').text(s.text, x, y, { lineBreak: false, wordSpacing: stretch });
      if (s.run.underline) doc.save().moveTo(x, y + size * 0.98).lineTo(x + w, y + size * 0.98).lineWidth(size / 18).stroke('#000').restore();
      x += w;
    }
    doc.y = y + lineH;
  }
  doc.x = LEFT;
  return doc.y - start;
}
function paragraph(doc: PDFKit.PDFDocument, runs: Run[], o: { x: number; width: number; align?: string; size?: number; gap?: number }) {
  const size = o.size ?? SIZE, parts = runs.filter((r) => r.text);
  if (!parts.length) { doc.y += size * 0.9; return; }
  need(doc, size * 1.4);
  richText(doc, parts, { x: o.x, width: o.width, align: ['left', 'center', 'right', 'justify'].includes(o.align ?? '') ? o.align : 'justify', size });
  doc.y += o.gap ?? PARA;
}

function heading(doc: PDFKit.PDFDocument, text: string, o: { size?: number; x?: number; caps?: boolean } = {}) {
  need(doc, 46); // keep the heading with the first lines that follow
  doc.font('Helvetica-Bold').fontSize(o.size ?? 10.8).fillColor('#000').text(pdfSafe(o.caps ? text.toLocaleUpperCase('pt-BR') : text), o.x ?? LEFT, doc.y + 4, { width: WIDTH - ((o.x ?? LEFT) - LEFT), lineGap: GAP });
  doc.x = LEFT; doc.y += 4;
}

/* Rich content --------------------------------------------------------------------------------- */
function blocks(doc: PDFKit.PDFDocument, nodes: RichNode[] | undefined, x: number, width: number, images: Map<string, Buffer>) {
  for (const n of nodes ?? []) block(doc, n, x, width, images);
}
function block(doc: PDFKit.PDFDocument, n: RichNode, x: number, width: number, images: Map<string, Buffer>) {
  const indent = Math.min(Number(n.attrs?.indent ?? 0) || 0, 6) * 18;
  switch (n.type) {
    case 'paragraph': return paragraph(doc, runsOf(n.content), { x: x + indent, width: width - indent, align: n.attrs?.textAlign ?? 'justify' });
    case 'heading': {
      const level = Number(n.attrs?.level ?? 2);
      need(doc, 46);
      return paragraph(doc, runsOf(n.content, { bold: true }), { x: x + indent, width: width - indent, align: n.attrs?.textAlign ?? 'left', size: level <= 2 ? 11.5 : 10.8, gap: 4 });
    }
    case 'bulletList': case 'orderedList': {
      let i = Number(n.attrs?.start ?? 1) || 1;
      for (const item of n.content ?? []) {
        const marker = n.type === 'bulletList' ? '•' : `${i++}.`;
        need(doc, SIZE * 1.5);
        const y = doc.y;
        doc.font('Helvetica').fontSize(SIZE).fillColor('#000').text(marker, x + 6, y, { width: 18, lineBreak: false });
        doc.x = LEFT; doc.y = y;
        blocks(doc, item.content, x + 22, width - 22, images);
        doc.y -= PARA - 2;
      }
      doc.y += PARA - 2;
      return;
    }
    case 'blockquote': {
      const startPage = (doc as unknown as { _pageBuffer: unknown[] })._pageBuffer.length, startY = doc.y;
      blocks(doc, n.content, x + 14, width - 14, images);
      if ((doc as unknown as { _pageBuffer: unknown[] })._pageBuffer.length === startPage) doc.save().moveTo(x + 4, startY).lineTo(x + 4, doc.y - PARA).lineWidth(2).strokeColor('#B9B9B9').stroke().restore();
      return;
    }
    case 'horizontalRule': need(doc, 12); doc.save().moveTo(x, doc.y + 4).lineTo(x + width, doc.y + 4).lineWidth(0.6).strokeColor(RULE).stroke().restore(); doc.y += 12; return;
    case 'pageBreak': doc.addPage(); return;
    case 'image': return image(doc, n.attrs ?? {}, x, width, images, 330);
    case 'table': return table(doc, n, x, width);
    default: if (n.content) blocks(doc, n.content, x, width, images);
  }
}

/** Storage key of an image inserted in the editor (src "/api/minutes/<id>/asset?key=..."). */
export function imageKey(src: unknown) { try { return new URL(String(src ?? ''), 'https://x').searchParams.get('key'); } catch { return null; } }
function image(doc: PDFKit.PDFDocument, attrs: Record<string, any>, x: number, width: number, images: Map<string, Buffer>, maxH: number, caption?: string) {
  const key = attrs.key ?? imageKey(attrs.src), bytes = key ? images.get(key) : undefined;
  if (!bytes) return;
  let img: { width: number; height: number };
  try { img = (doc as unknown as { openImage: (b: Buffer) => { width: number; height: number } }).openImage(bytes); } catch { return; }
  const k = Math.min(width / img.width, maxH / img.height, 1.2), w = img.width * k, h = img.height * k;
  const capH = caption ? doc.font('Helvetica-Oblique').fontSize(8.6).heightOfString(pdfSafe(caption), { width }) + 6 : 0;
  need(doc, h + capH + 8);
  doc.image(bytes as unknown as string, x + (width - w) / 2, doc.y, { width: w, height: h });
  doc.y += h + 4;
  if (caption) { doc.font('Helvetica-Oblique').fontSize(8.6).fillColor('#333').text(pdfSafe(caption), x, doc.y, { width, align: 'center', lineGap: 1 }); doc.fillColor('#000'); }
  doc.x = LEFT; doc.y += PARA;
}

type Cell = { text: string; colSpan?: number; rowSpan?: number; backgroundColor?: string; font?: { src: string; size: number }; align?: { x: string; y: string }; border?: number };
function table(doc: PDFKit.PDFDocument, n: RichNode, x: number, width: number) {
  const bordered = n.attrs?.bordered !== false;
  const rows = (n.content ?? []).filter((r) => r.type === 'tableRow');
  if (!rows.length) return;
  // Column widths from the editor (pixels, resized by the user) or equal parts.
  const first = rows[0].content ?? [], px: Array<number | null> = [];
  for (const cell of first) { const span = Number(cell.attrs?.colspan ?? 1) || 1, cw = cell.attrs?.colwidth as number[] | null; for (let i = 0; i < span; i++) px.push(cw?.[i] ?? null); }
  const known = px.filter((v): v is number => !!v), missing = px.length - known.length;
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 100;
  const raw = px.map((v) => v ?? (missing === px.length ? 100 : avg)), total = raw.reduce((a, b) => a + b, 0);
  const widths = raw.map((v) => (v / total) * width);
  const data: Cell[][] = rows.map((r) => (r.content ?? []).map((cell) => {
    const header = cell.type === 'tableHeader', paras = cell.content ?? [];
    const runs = paras.map((p) => runsOf(p.content));
    const text = runs.map((rs) => rs.map((r) => r.text).join('')).join('\n');
    const allBold = runs.flat().length > 0 && runs.flat().every((r) => r.bold);
    return {
      text, colSpan: Number(cell.attrs?.colspan ?? 1) || 1, rowSpan: Number(cell.attrs?.rowspan ?? 1) || 1,
      backgroundColor: cell.attrs?.backgroundColor || (header ? '#E9E9E9' : undefined),
      font: { src: header || allBold ? 'Helvetica-Bold' : 'Helvetica', size: 9.4 },
      align: { x: (paras[0]?.attrs?.textAlign === 'justify' ? 'left' : paras[0]?.attrs?.textAlign) ?? (header ? 'center' : 'left'), y: 'center' },
      border: bordered ? 0.6 : 0
    };
  }));
  need(doc, 40);
  doc.fillColor('#000');
  doc.table({ position: { x, y: doc.y }, maxWidth: width, columnStyles: widths.map((w) => ({ width: w })), defaultStyle: { padding: 4, borderColor: '#555555' }, data: data as never });
  doc.x = LEFT; doc.y += PARA + 2;
}

/* The ata --------------------------------------------------------------------------------------- */
function body(doc: PDFKit.PDFDocument, c: MinuteContent, o: MinutePdfOptions) {
  // Orange title band.
  const title = pdfSafe(c.title.toLocaleUpperCase('pt-BR')), sub = pdfSafe(c.subject);
  doc.font('Helvetica-Bold');
  const th = doc.fontSize(12.5).heightOfString(title, { width: WIDTH - 20 }) + (sub ? doc.fontSize(10.6).heightOfString(sub, { width: WIDTH - 20 }) + 3 : 0) + 14;
  doc.save().rect(LEFT, doc.y, WIDTH, th).fillAndStroke(ORANGE, '#333333').restore();
  const ty = doc.y + 7;
  doc.font('Helvetica-Bold').fontSize(12.5).fillColor('#000').text(title, LEFT + 10, ty, { width: WIDTH - 20, align: 'center' });
  if (sub) doc.font('Helvetica-Bold').fontSize(10.6).fillColor(ORANGE_DARK).text(sub, LEFT + 10, doc.y + 2, { width: WIDTH - 20, align: 'center' });
  doc.fillColor('#000'); doc.x = LEFT; doc.y = ty - 7 + th + 16;

  blocks(doc, c.intro.content, LEFT, WIDTH, o.images);

  for (const t of numberTopics(c.topics)) {
    heading(doc, `${t.number}. ${t.topic.title || 'Tópico'}`);
    blocks(doc, t.topic.body?.content, LEFT, WIDTH, o.images);
    for (const s of t.children) { heading(doc, `${s.number} ${s.topic.title || 'Subtópico'}`, { size: 10.5 }); blocks(doc, s.topic.body?.content, LEFT, WIDTH, o.images); }
  }

  if (c.decisions.content.length && JSON.stringify(c.decisions).includes('"text"')) { heading(doc, 'DECISÕES E ENCAMINHAMENTOS'); blocks(doc, c.decisions.content, LEFT, WIDTH, o.images); }

  heading(doc, 'PRÓXIMA REUNIÃO');
  const nm = c.nextMeeting, when = [nm.date ? `Data: ${dateShort(nm.date)}` : '', nm.time ? `às ${timeText(nm.time).replace(/ \(.*/, '')}` : ''].filter(Boolean).join(', ');
  paragraph(doc, [{ text: pdfSafe(when ? `${when}.` : 'Não foi definida data nesta reunião.'), bold: false, italic: false, underline: false }], { x: LEFT, width: WIDTH, gap: nm.notes.trim() ? 3 : PARA });
  if (nm.notes.trim()) paragraph(doc, [{ text: pdfSafe(nm.notes.trim()), bold: false, italic: false, underline: false }], { x: LEFT, width: WIDTH });

  doc.y += 4;
  blocks(doc, c.closing.content, LEFT, WIDTH, o.images);
  doc.y += 8;
  paragraph(doc, [{ text: pdfSafe(`${c.place || 'Palmas, TO'}, ${dateLong(c.meetingDate) || '____ de __________ de ______'}.`), bold: false, italic: false, underline: false }], { x: LEFT, width: WIDTH, align: 'left', gap: 14 });

  attendance(doc, c);
  signatures(doc, c, o);
  authenticity(doc, c, o);
  annexes(doc, c, o);
}

function attendance(doc: PDFKit.PDFDocument, c: MinuteContent) {
  if (!c.participants.length) return;
  heading(doc, 'LISTA DE PRESENÇA');
  const data: Cell[][] = [['Participante', 'Instituição', 'Função', 'Situação'].map((t) => ({ text: t, font: { src: 'Helvetica-Bold', size: 8.8 }, backgroundColor: '#E9E9E9', align: { x: 'left', y: 'center' } }))];
  for (const p of c.participants) data.push([p.name, p.institution || '—', p.role || '—', ATTENDANCE_LABEL[p.attendance]].map((t) => ({ text: pdfSafe(t), font: { src: 'Helvetica', size: 8.8 }, align: { x: 'left', y: 'center' } })));
  need(doc, 60);
  doc.table({ position: { x: LEFT, y: doc.y }, maxWidth: WIDTH, columnStyles: [0.34, 0.24, 0.24, 0.18].map((k) => ({ width: k * WIDTH })), defaultStyle: { padding: 3.5, border: 0.5, borderColor: '#777777' }, data: data as never });
  doc.x = LEFT; doc.y += 14;
}

/** System seal in place of the SEI mark: pivot emblem, "RTP", padlock and "assinatura eletrônica". */
export function drawSeal(doc: PDFKit.PDFDocument, x: number, y: number) {
  const w = 70, h = 38;
  doc.save().roundedRect(x, y, w, h, 3).lineWidth(0.9).fillAndStroke('#F3F4F3', '#8F9893').restore();
  const cx = x + 13, cy = y + 14, r = 8.5, colors = ['#2E7A4E', '#2E7A4E', '#2E7A4E', '#D9B14F', '#DCE3DF'];
  colors.forEach((color, i) => {
    const a0 = ((i * 72) - 90) * Math.PI / 180, a1 = (((i + 1) * 72) - 90) * Math.PI / 180;
    doc.save().path(`M ${cx} ${cy} L ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z`).fill(color).restore();
  });
  doc.save().circle(cx, cy, r).lineWidth(0.5).stroke('#12303A').restore();
  doc.save().moveTo(cx, cy).lineTo(cx + r * Math.cos(-0.35), cy + r * Math.sin(-0.35)).lineWidth(0.9).stroke('#12303A').circle(cx, cy, 1.4).fill('#12303A').restore();
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#12303A').text('RTP', x + 25, y + 7.2, { lineBreak: false });
  // padlock
  const lx = x + w - 8, ly = y + 7;
  doc.save().roundedRect(lx - 3.6, ly + 1.4, 7.2, 5.6, 0.8).fill('#12303A').restore();
  doc.save().path(`M ${lx - 2.3} ${ly + 1.6} L ${lx - 2.3} ${ly - 0.4} A 2.3 2.3 0 0 1 ${lx + 2.3} ${ly - 0.4} L ${lx + 2.3} ${ly + 1.6}`).lineWidth(1.1).stroke('#12303A').restore();
  doc.font('Helvetica').fontSize(5.7).fillColor('#333').text('assinatura eletrônica', x, y + h - 10, { width: w, align: 'center', lineBreak: false });
  doc.fillColor('#000');
}

const signedWhen = (iso: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.day}/${p.month}/${p.year}`, time: `${p.hour}h${p.minute}` };
};
export const signatureId = (hash: string) => hash.slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');

function signatures(doc: PDFKit.PDFDocument, c: MinuteContent, o: MinutePdfOptions) {
  heading(doc, 'ASSINATURAS ELETRÔNICAS');
  if (!o.signatures.length) {
    paragraph(doc, [{ text: o.draft ? 'Minuta em elaboração: as assinaturas eletrônicas serão colhidas depois que a ata for finalizada.' : `Nenhuma assinatura registrada até o momento${o.totalSigners ? ` (0 de ${o.totalSigners})` : ''}.`, bold: false, italic: true, underline: false }], { x: LEFT, width: WIDTH, align: 'left', size: 9.4 });
    return;
  }
  const tx = LEFT + 80, tw = WIDTH - 80;
  doc.save().moveTo(LEFT, doc.y).lineTo(LEFT + WIDTH, doc.y).lineWidth(0.5).strokeColor('#A8A8A8').stroke().restore();
  for (const s of o.signatures) {
    const w = signedWhen(s.signedAt);
    const parts: Run[] = [
      { text: 'Documento assinado eletronicamente por ', bold: false, italic: false, underline: false },
      { text: pdfSafe(s.name.toLocaleUpperCase('pt-BR')), bold: true, italic: false, underline: false },
      ...(s.roleLabel ? [{ text: ', na qualidade de ', bold: false, italic: false, underline: false }, { text: pdfSafe(s.roleLabel), bold: true, italic: false, underline: false }] : []),
      { text: ', em ', bold: false, italic: false, underline: false }, { text: `${w.date}, às ${w.time}`, bold: true, italic: false, underline: false },
      { text: ', conforme horário oficial de Brasília e registro eletrônico de assinatura da plataforma RTP Inteligente, com fundamento na Lei nº 14.063/2020. Identificador da assinatura: ', bold: false, italic: false, underline: false },
      { text: signatureId(s.signatureHash), bold: true, italic: false, underline: false }, { text: '.', bold: false, italic: false, underline: false }
    ];
    doc.font('Helvetica-Bold').fontSize(8.6);
    const th = doc.heightOfString(parts.map((p) => p.text).join(''), { width: tw, lineGap: 1.2 }) + 4, h = Math.max(46, th + 12);
    if (doc.y + h > bottomY(doc)) { doc.addPage(); doc.save().moveTo(LEFT, doc.y).lineTo(LEFT + WIDTH, doc.y).lineWidth(0.5).strokeColor('#A8A8A8').stroke().restore(); }
    const y0 = doc.y;
    drawSeal(doc, LEFT + 1, y0 + (h - 38) / 2);
    const ty = y0 + (h - th) / 2 + 2;
    doc.y = ty; richText(doc, parts, { x: tx, width: tw, align: 'left', size: 8.6, lineGap: 1.2 });
    doc.x = LEFT; doc.y = y0 + h;
    doc.save().moveTo(LEFT, doc.y).lineTo(LEFT + WIDTH, doc.y).lineWidth(0.5).strokeColor('#A8A8A8').stroke().restore();
  }
  if (o.totalSigners > o.signatures.length) { doc.y += 5; paragraph(doc, [{ text: `${o.signatures.length} de ${o.totalSigners} assinaturas concluídas. As demais aparecerão aqui à medida que forem registradas.`, bold: false, italic: true, underline: false }], { x: LEFT, width: WIDTH, align: 'left', size: 8.6 }); }
  else doc.y += 10;
}

/** QR matrix drawn as vector squares. */
export function drawQr(doc: PDFKit.PDFDocument, text: string, x: number, y: number, size: number) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), cell = size / (n + 2);
  doc.save().rect(x, y, size, size).fill('#FFFFFF');
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) doc.rect(x + (col + 1) * cell, y + (r + 1) * cell, cell + 0.02, cell + 0.02);
  doc.fill('#000000').restore();
}

function authenticity(doc: PDFKit.PDFDocument, c: MinuteContent, o: MinutePdfOptions) {
  if (!o.code || !o.verifyUrl) {
    need(doc, 40);
    doc.y += 6;
    paragraph(doc, [{ text: 'AUTENTICIDADE DO DOCUMENTO: ', bold: true, italic: false, underline: false }, { text: 'o código de verificação e o QR Code são gerados quando a ata é finalizada.', bold: false, italic: true, underline: false }], { x: LEFT, width: WIDTH, align: 'left', size: 8.8 });
    return;
  }
  const qr = 78, h = 96;
  need(doc, h + 10);
  doc.y += 6;
  const y0 = doc.y;
  doc.save().rect(LEFT, y0, WIDTH, h).lineWidth(0.6).strokeColor('#A8A8A8').stroke().restore();
  drawQr(doc, o.verifyUrl, LEFT + 9, y0 + (h - qr) / 2, qr);
  const tx = LEFT + qr + 22, tw = WIDTH - qr - 32;
  doc.font('Helvetica-Bold').fontSize(9.4).fillColor('#000').text('AUTENTICIDADE DO DOCUMENTO', tx, y0 + 9, { width: tw });
  doc.font('Helvetica').fontSize(8.4).text('A autenticidade deste documento pode ser conferida pelo QR Code ao lado ou no endereço ', tx, doc.y + 2, { width: tw, lineGap: 1, continued: true })
    .fillColor('#0B4F8A').text(o.verifyUrl, { link: o.verifyUrl, underline: true, continued: true }).fillColor('#000').text(', informando o código de verificação abaixo.', { underline: false });
  doc.font('Helvetica').fontSize(8.4).text('Código de verificação: ', tx, doc.y + 3, { width: tw, continued: true }).font('Helvetica-Bold').text(o.code);
  doc.font('Helvetica').fontSize(8.4).text(`Documento: ${c.number}   ·   Versão: ${o.version ?? 1}${o.issuedAt ? `   ·   Emitido em ${signedWhen(o.issuedAt).date}` : ''}`, tx, doc.y + 1, { width: tw });
  if (o.contentHash) doc.font('Helvetica').fontSize(6.6).fillColor('#444').text(`Hash do conteúdo (SHA-256): ${o.contentHash}`, tx, doc.y + 2, { width: tw });
  doc.fillColor('#000'); doc.x = LEFT; doc.y = y0 + h + 10;
}

function band(doc: PDFKit.PDFDocument, text: string) {
  doc.font('Helvetica-Bold').fontSize(11.5);
  const h = doc.heightOfString(text, { width: WIDTH - 16 }) + 12;
  doc.save().rect(LEFT, doc.y, WIDTH, h).fillAndStroke(ORANGE, '#333333').restore();
  const y = doc.y;
  doc.fillColor('#000').text(text, LEFT + 8, y + 6.5, { width: WIDTH - 16, align: 'center' });
  doc.x = LEFT; doc.y = y + h + 18;
}

function annexes(doc: PDFKit.PDFDocument, c: MinuteContent, o: MinutePdfOptions) {
  const pictures = c.attachments.filter((a) => a.mime.startsWith('image/')), files = c.attachments.filter((a) => !a.mime.startsWith('image/'));
  let roman = 0; const ROMAN = ['I', 'II', 'III', 'IV'];
  if (pictures.length) {
    doc.addPage();
    band(doc, `ANEXO ${ROMAN[roman++]} – REGISTRO FOTOGRÁFICO (PROVA DOCUMENTAL)`);
    pictures.forEach((p, i) => image(doc, { key: p.key }, LEFT, WIDTH, o.images, 470, `Figura ${i + 1} – ${p.caption || p.name}`));
  }
  if (files.length) {
    if (!pictures.length) doc.addPage(); else need(doc, 120);
    band(doc, `ANEXO ${ROMAN[roman++]} – DOCUMENTOS COMPLEMENTARES`);
    const data: Cell[][] = [['Nº', 'Documento', 'Descrição', 'Tamanho'].map((t) => ({ text: t, font: { src: 'Helvetica-Bold', size: 8.8 }, backgroundColor: '#E9E9E9' }))];
    files.forEach((f, i) => data.push([String(i + 1), f.name, f.caption || '—', `${Math.max(1, Math.round(f.size / 1024))} KB`].map((t) => ({ text: pdfSafe(t), font: { src: 'Helvetica', size: 8.8 } }))));
    doc.table({ position: { x: LEFT, y: doc.y }, maxWidth: WIDTH, columnStyles: [0.07, 0.4, 0.38, 0.15].map((k) => ({ width: k * WIDTH })), defaultStyle: { padding: 3.5, border: 0.5, borderColor: '#777777' }, data: data as never });
    doc.x = LEFT; doc.y += 8;
    paragraph(doc, [{ text: 'Os documentos complementares ficam arquivados com esta ata na plataforma RTP Inteligente.', bold: false, italic: true, underline: false }], { x: LEFT, width: WIDTH, align: 'left', size: 8.4 });
  }
}

/* Header, footer and watermark on every page ------------------------------------------------- */
function decorate(doc: PDFKit.PDFDocument, c: MinuteContent, o: MinutePdfOptions) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const keep = doc.page.margins.bottom; doc.page.margins.bottom = 0; // write in the margins without new pages
    doc.image(LOGO_UFT as unknown as string, LEFT, 26, { fit: [44, 46] });
    doc.image(LOGO_PAJE as unknown as string, PAGE.w - RIGHT - 88, 30, { fit: [88, 44] });
    doc.image(LOGO_POLO as unknown as string, PAGE.w - RIGHT - 88 - 66, 22, { fit: [60, 54] });
    const tx = LEFT + 52, tw = PAGE.w - RIGHT - 88 - 66 - 8 - tx;
    let y = 30;
    for (const line of c.header.lines.filter((l) => l.trim())) { doc.font('Helvetica-Bold').fontSize(8.4).fillColor('#000').text(pdfSafe(line), tx, y, { width: tw, align: 'center', lineGap: 0.2 }); y = doc.y; }
    doc.font('Helvetica').fontSize(7.4).fillColor(GRAY).text(pdfSafe(c.header.address), LEFT - 10, 84, { width: WIDTH + 20, align: 'center', lineBreak: false });
    doc.save().moveTo(LEFT, 96).lineTo(PAGE.w - RIGHT, 96).lineWidth(0.8).strokeColor(RULE).stroke().restore();
    const footer = `${c.header.footer || 'Ata de Reunião'} | ${c.number}${o.draft ? ' (minuta)' : o.version ? ` · versão ${o.version}` : ''} | Página ${i - range.start + 1} de ${range.count}`;
    doc.font('Helvetica').fontSize(7.6).fillColor(GRAY).text(pdfSafe(footer), LEFT, PAGE.h - 38, { width: WIDTH, align: 'center', lineBreak: false });
    if (o.draft) {
      doc.save().rotate(-35, { origin: [PAGE.w / 2, PAGE.h / 2] }).font('Helvetica-Bold').fontSize(54).fillColor('#C0392B').fillOpacity(0.08)
        .text('MINUTA — NÃO FINALIZADA', 0, PAGE.h / 2 - 30, { width: PAGE.w, align: 'center', lineBreak: false }).restore();
    }
    doc.fillColor('#000'); doc.page.margins.bottom = keep;
  }
}
