import fs from 'node:fs/promises';
import mammoth from 'mammoth';
import pdf from 'pdf-parse';

export async function extractText(filePath: string, mime: string) {
  return extractBuffer(await fs.readFile(filePath),mime);
}

export async function extractBuffer(buffer:Buffer,mime:string){
  if (mime === 'application/pdf') return (await pdf(buffer)).text;
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return (await mammoth.extractRawText({ buffer })).value;
  if (mime === 'application/msword') throw Object.assign(new Error('DOC legado deve ser convertido para DOCX antes da extração.'), { status: 422 });
  throw Object.assign(new Error('Formato não suportado.'), { status: 415 });
}

export function structurePlan(text: string) {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  const lines = clean.split('\n').map((x) => x.trim()).filter(Boolean);
  const buckets: Record<string, Array<{ title: string; description: string; source_reference: object }>> = { objective: [], goal: [], activity: [], product: [], dependency: [], indicator: [] };
  let active: keyof typeof buckets = 'activity';
  const headings: Record<string, keyof typeof buckets> = { objetivo: 'objective', meta: 'goal', atividade: 'activity', produto: 'product', entrega: 'product', dependência: 'dependency', indicador: 'indicator' };
  lines.forEach((line, i) => {
    const normalized = line.toLocaleLowerCase('pt-BR');
    const heading = Object.entries(headings).find(([word]) => normalized.includes(word) && line.length < 90);
    if (heading) { active = heading[1]; if (/[:–-]\s*\S/.test(line)) buckets[active].push({ title: line.replace(/^.*?[:–-]\s*/, ''), description: '', source_reference: { line: i + 1 } }); return; }
    if (line.length > 18 && !/^(plano de trabalho|cronograma|identificação)/i.test(line)) buckets[active].push({ title: line.slice(0, 180), description: line.length > 180 ? line : '', source_reference: { line: i + 1 } });
  });
  return { items: buckets, sourceText: clean };
}
