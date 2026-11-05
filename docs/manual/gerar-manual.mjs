import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

// Execute na raiz do projeto: node docs/manual/gerar-manual.mjs
const directory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(directory, 'manual-do-usuario.md'), 'utf8');
const pages = source.trim().split(/\r?\n<!-- page -->\r?\n/);
const output = path.join(directory, 'Manual-do-Usuario-RTP-Inteligente.pdf');
for (const match of source.matchAll(/!\[[^\]]+\]\(([^)]+)\)/g)) {
  if (!fs.existsSync(path.resolve(directory, match[1]))) throw new Error(`Gere primeiro a figura: ${match[1]}`);
}
const doc = new PDFDocument({ size: 'A4', margin: 52, autoFirstPage: false, bufferPages: true,
  info: { Title: 'Manual do Usuário — RTP Inteligente', Author: 'RTP Inteligente', Subject: 'Guia de utilização dos módulos do sistema', Keywords: 'manual, RTP, WhatsApp, documentos, atas, assinaturas' } });
const temporaryOutput = `${output}.tmp`;
const stream = fs.createWriteStream(temporaryOutput);
doc.pipe(stream);
const color = { ink: '#173b43', green: '#216444', muted: '#52696e', pale: '#EFF6F2', gold: '#C4A15A' };
const width = 491.28;
const titles = pages.map(page => page.split(/\r?\n/).find(line => line.startsWith('# '))?.slice(2) || '');
const flows = {
  rtp: [['Preparar', 'Projeto, membro e Plano de Trabalho conferido'], ['Registrar', 'Atividades realizadas, resultados e evidências'], ['Gerar e revisar', 'Selecionar o período, revisar texto e pendências'], ['Solicitar assinaturas', 'Confirmar os participantes e enviar o link'], ['Membro revisa e assina', 'Entrar na própria conta, editar, salvar e confirmar CPF'], ['Coordenação e arquivo final', 'Concluir a ordem e baixar o PDF com assinaturas']],
  external: [['Cadastrar o convidado', 'Nome, instituição, CPF e WhatsApp com DDI e DDD'], ['Finalizar e encaminhar a ata', 'O convidado recebe um link individual válido por 7 dias'], ['Conferir o CPF', 'O CPF precisa corresponder ao cadastrado para o convite'], ['Confirmar o WhatsApp', 'Receber o código: validade de 5 minutos e até 5 tentativas'], ['Ler a ata e assinar', 'Confirmar o CPF e a declaração; identidade vale por 10 minutos'], ['Concluir a coleta', 'O PDF usa o mesmo mecanismo de assinatura e verificação das atas']]
};
function drawFlow(name) {
  const nodes = flows[name];
  if (!nodes) throw new Error(`Fluxo desconhecido: ${name}`);
  for (const [index, [title, detail]] of nodes.entries()) {
    const y = doc.y;
    doc.roundedRect(52, y, width, 62, 6).fillAndStroke(index === nodes.length - 1 ? '#E6F2E9' : '#F1F6F7', '#C6D6D0');
    doc.circle(76, y + 23, 12).fill(color.green);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#FFFFFF').text(String(index + 1), 68, y + 18, { width: 16, align: 'center' });
    doc.fontSize(12).fillColor(color.ink).text(title, 101, y + 12, { width: width - 65 });
    doc.font('Helvetica').fontSize(9.5).fillColor(color.muted).text(detail, 101, y + 31, { width: width - 65 });
    if (index < nodes.length - 1) {
      doc.moveTo(297, y + 63).lineTo(297, y + 76).lineWidth(1.1).strokeColor(color.green).stroke();
      doc.moveTo(293, y + 72).lineTo(297, y + 77).lineTo(301, y + 72).stroke();
    }
    doc.x = 52; doc.y = y + 84;
  }
}

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
        doc.font('Helvetica').fontSize(9.8).fillColor(color.ink).text(titles[index], 52, y, { width: width - 35, goTo: `chapter-${index}` });
        doc.font('Helvetica-Bold').fillColor(color.green).text(String(index + 1).padStart(2, '0'), 510, y, { width: 33, align: 'right', goTo: `chapter-${index}` });
        doc.y = y + Math.min(23, 570 / (titles.length - 2));
      }
    } else if (/^\[fluxo:(\w+)\]$/.test(text)) {
      drawFlow(/^\[fluxo:(\w+)\]$/.exec(text)[1]);
    } else if (text.startsWith('![')) {
      const match = /^!\[([^\]]+)\]\(([^)]+)\)$/.exec(text);
      if (!match) throw new Error(`Figura inválida: ${text}`);
      const file = path.resolve(directory, match[2]);
      if (!file.startsWith(directory + path.sep)) throw new Error('Figura fora da pasta do manual');
      const img = doc.openImage(file), scale = Math.min(width / img.width, 405 / img.height);
      const w = img.width * scale, h = img.height * scale, y = doc.y;
      doc.image(file, 52 + (width - w) / 2, y, { width: w, height: h });
      doc.y = y + h + 12;
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(color.muted).text(match[1], 52, doc.y, { width, lineGap: 2 });
      doc.moveDown(0.8);
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
  doc.font('Helvetica').fontSize(8).fillColor(color.muted).text('Edição ilustrada 1.1  •  05/11/2026', 52, 799, { lineBreak: false });
  doc.text(`${index + 1} / ${pages.length}`, 474, 799, { width: 69, align: 'right', lineBreak: false });
  doc.page.margins.bottom = bottomMargin;
}
if (doc.bufferedPageRange().count !== pages.length) throw new Error('O rodapé criou páginas adicionais');
doc.end();
await new Promise((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); doc.on('error', reject); });
fs.renameSync(temporaryOutput, output);
const publicDirectory = path.resolve(directory, '../../public/manual');
fs.mkdirSync(publicDirectory, { recursive: true });
fs.copyFileSync(output, path.join(publicDirectory, path.basename(output)));
console.log(`PDF gerado: ${output} (${pages.length} páginas)`);
