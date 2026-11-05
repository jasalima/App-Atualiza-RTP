import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

// Execute na raiz do projeto: node docs/manual/gerar-manual.mjs
const directory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(directory, 'manual-do-usuario.md'), 'utf8');
const pages = source.trim().split(/\r?\n<!-- page -->\r?\n/);
const output = path.join(directory, 'Manual-do-Usuario-RTP-Inteligente.pdf');
const doc = new PDFDocument({ size: 'A4', margin: 52, autoFirstPage: false, bufferPages: true,
  info: { Title: 'Manual do Usuário — RTP Inteligente', Author: 'RTP Inteligente', Subject: 'Guia de utilização dos módulos do sistema', Keywords: 'manual, RTP, WhatsApp, documentos, atas, assinaturas' } });
const stream = fs.createWriteStream(output);
doc.pipe(stream);
const color = { ink: '#193743', green: '#257353', muted: '#596973', pale: '#EFF6F2', gold: '#C4A15A' };
const width = 491.28;
const titles = pages.map(page => page.split(/\r?\n/).find(line => line.startsWith('# '))?.slice(2) || '');

for (const [pageIndex, page] of pages.entries()) {
  doc.addPage();
  doc.addNamedDestination(`chapter-${pageIndex}`);
  if (pageIndex === 0) {
    doc.rect(0, 0, doc.page.width, 282).fill(color.ink);
    doc.rect(52, 60, 48, 5).fill(color.gold);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(16).text('RTP INTELIGENTE', 52, 91);
    doc.fontSize(35).text('Manual do\nusuário', 52, 133, { lineGap: 4 });
    doc.y = 316;
  } else {
    doc.rect(0, 0, doc.page.width, 8).fill(color.green);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(color.muted).text('RTP INTELIGENTE  /  GUIA DE UTILIZAÇÃO', 52, 31);
    doc.y = 69;
  }
  for (const line of page.split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith('<!--')) continue;
    if (text.startsWith('# ')) {
      if (pageIndex === 0) continue;
      doc.font('Helvetica-Bold').fontSize(23).fillColor(color.ink).text(text.slice(2), 52, doc.y, { width, lineGap: 2 });
      doc.moveDown(0.6);
      doc.outline.addItem(text.slice(2), { expanded: false });
    } else if (text === '[sumario]') {
      for (let index = 2; index < titles.length; index++) {
        const y = doc.y;
        doc.font('Helvetica').fontSize(10.3).fillColor(color.ink).text(titles[index], 52, y, { width: width - 35, goTo: `chapter-${index}` });
        doc.font('Helvetica-Bold').fillColor(color.green).text(String(index + 1).padStart(2, '0'), 510, y, { width: 33, align: 'right', goTo: `chapter-${index}` });
        doc.y = y + 23;
      }
    } else if (text.startsWith('## ')) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(13).fillColor(color.green).text(text.slice(3), 52, doc.y, { width });
      doc.moveDown(0.45);
    } else {
      const note = text.startsWith('> ');
      const body = note ? text.slice(2) : text;
      doc.font(note ? 'Helvetica-Oblique' : 'Helvetica').fontSize(10.6);
      const options = { width: width - (note ? 22 : 0), lineGap: 3.2, paragraphGap: 0 };
      const height = doc.heightOfString(body, options);
      if (doc.y + height > 760) throw new Error(`Conteúdo excede a página ${pageIndex + 1}: ${body.slice(0, 70)}`);
      if (note) {
        const y = doc.y;
        doc.rect(52, y - 5, width, height + 12).fill(color.pale);
        doc.rect(52, y - 5, 3, height + 12).fill(color.green);
        doc.fillColor(color.ink).text(body, 63, y, options);
        doc.x = 52;
        doc.moveDown(0.8);
      } else {
        doc.fillColor(color.ink).text(body, 52, doc.y, options);
        doc.moveDown(0.6);
      }
    }
  }
  if (doc.bufferedPageRange().count !== pageIndex + 1) throw new Error(`Quebra automática inesperada na página ${pageIndex + 1}`);
}
for (let index = 0; index < pages.length; index++) {
  doc.switchToPage(index);
  // O rodapé fica abaixo da margem do conteúdo sem criar páginas adicionais.
  const bottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.moveTo(52, 788).lineTo(543, 788).strokeColor('#DCE5E1').lineWidth(0.6).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(color.muted).text('Edição 1.0  •  05/11/2026', 52, 799, { lineBreak: false });
  doc.text(`${index + 1} / ${pages.length}`, 474, 799, { width: 69, align: 'right', lineBreak: false });
  doc.page.margins.bottom = bottomMargin;
}
if (doc.bufferedPageRange().count !== pages.length) throw new Error('O rodapé criou páginas adicionais');
doc.end();
await new Promise((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); doc.on('error', reject); });
console.log(`PDF gerado: ${output} (${pages.length} páginas)`);
