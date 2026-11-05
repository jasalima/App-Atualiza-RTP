import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url), parse = require('pdf-parse/lib/pdf-parse.js');
const file = 'docs/manual/Manual-do-Usuario-RTP-Inteligente.pdf', bytes = fs.readFileSync(file), pages = [];
const parsed = await parse(bytes, { pagerender: async page => {
  const c = await page.getTextContent(); pages.push({ n: page.pageNumber, count: c.items.length, minY: Math.min(...c.items.map(x => x.transform[5])) });
  return c.items.map(x => x.str).join(' ');
} });
assert.equal(parsed.numpages, 37);
assert(pages.every(p => p.count > 5 && p.minY >= 25), 'Sem páginas vazias ou conteúdo abaixo do rodapé.');
assert(bytes.equals(fs.readFileSync('public/manual/Manual-do-Usuario-RTP-Inteligente.pdf')), 'A cópia pública deve ser idêntica.');
for (const term of ['Conectar meu WhatsApp', 'Revisar e editar RTP', 'CPF confirmado', '35. Tela: manual disponível online']) assert(parsed.text.includes(term), `Texto ausente: ${term}`);
fs.mkdirSync('docs/manual/qa', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 1150 } });
  await page.route('https://manual-qa.invalid/worker.js', route => route.fulfill({ path: 'node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.worker.js', contentType: 'application/javascript' }));
  await page.setContent('<html><body style="margin:0;background:white"><canvas id="pdf"></canvas></body></html>');
  await page.addScriptTag({ path: 'node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.worker.js' });
  await page.addScriptTag({ path: 'node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js' });
  const navigation = await page.evaluate(async data => {
    const library = window.pdfjsDistBuildPdf;
    library.PDFJS.disableWorker = true;
    library.PDFJS.workerSrc = 'https://manual-qa.invalid/worker.js';
    window.qaPdf = await library.getDocument({ data: Uint8Array.from(data), disableWorker: true }).promise;
    const outline = await window.qaPdf.getOutline(), destinations = await window.qaPdf.getDestinations();
    const sumario = await (await window.qaPdf.getPage(2)).getAnnotations();
    return { outlines: outline.length, destinations: Object.keys(destinations).length, links: sumario.filter(a => a.subtype === 'Link').length };
  }, Array.from(bytes));
  assert.equal(navigation.destinations, 37); assert.equal(navigation.outlines, 36); assert(navigation.links >= 35);
  for (const number of [2, 29, 30, 32, 34, 36]) {
    await page.evaluate(async n => {
      const p = await window.qaPdf.getPage(n), viewport = p.getViewport(1.3), canvas = document.getElementById('pdf');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }, number);
    await page.locator('canvas').screenshot({ path: `docs/manual/qa/pagina-${number}.png` });
  }
  console.log(JSON.stringify({ pages: parsed.numpages, bytes: bytes.length, textAndBounds: 'OK', publicCopy: 'idêntica', navigation, renderedPages: [2, 29, 30, 32, 34, 36] }));
} finally { await browser.close(); }
