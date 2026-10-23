import { addMonths } from '../../lib/schedule';

// Reads the "CRONOGRAMA DE ATIVIDADES INDIVIDUALIZADO" table of a work plan.
// Plain text extraction flattens the table ("... X X X X X"), losing which
// column each mark belongs to, so PDFs are read from positioned text items and
// DOCX files from their HTML table.

export type PositionedItem = { page: number; x: number; y: number; w: number; s: string };
export type ScheduleColumn = { label: string; months: string[] };
export type ScheduleRow = { activity: string; columns: number[]; months: string[] };
export type Schedule = { columns: ScheduleColumn[]; rows: ScheduleRow[] };

export const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
const isMark = (s: string) => /^[x✓✔•●]$/i.test(s.trim());
const monthIndex: Record<string, number> = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const fullNames = new Set(['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']);
const pad = (n: number) => String(n).padStart(2, '0');

/** "09/2026 a 11/2027" (or full dates) next to "Vigência da Bolsa". */
export function parseValidity(text: string): { start: string; end: string } | null {
  const t = normalize(text);
  const m = t.match(/vigencia da bolsa:?\s*(?:\d{1,2}\/)?(\d{1,2})\/(\d{4})\s*(?:a|ate|-)\s*(?:\d{1,2}\/)?(\d{1,2})\/(\d{4})/);
  return m ? { start: `${m[2]}-${pad(+m[1])}`, end: `${m[4]}-${pad(+m[3])}` } : null;
}

/**
 * Turns a column header into months. Handles "Set;Out;Nov;Dez 2026",
 * "Nov/2026", "Dez 2026 Jan 2027", "Mês 3" (relative to the scholarship start)
 * and headers without a year, which continue chronologically from `after`.
 */
export function parseMonthLabel(label: string, ctx: { start?: string; after?: string } = {}): string[] {
  const tokens = normalize(label).match(/[a-z]+|\d+/g) ?? [];
  const entries: Array<{ month: number; year?: number }> = [];
  let pendingFrom = 0, relative: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^(mes|meses|m)$/.test(t) && /^\d{1,2}$/.test(tokens[i + 1] ?? '')) { relative.push(+tokens[++i]); continue; }
    const key = t.slice(0, 3);
    if (/^[a-z]+$/.test(t) && monthIndex[key] && (t.length === 3 || fullNames.has(t))) { entries.push({ month: monthIndex[key] }); continue; }
    if (/^\d{4}$/.test(t) || (/^\d{2}$/.test(t) && entries.length > pendingFrom && +t >= 20)) {
      const year = t.length === 4 ? +t : 2000 + +t;
      for (let j = pendingFrom; j < entries.length; j++) entries[j].year = year;
      pendingFrom = entries.length;
    }
  }
  if (!entries.length && relative.length && ctx.start) return relative.map((n) => addMonths(ctx.start!, n - 1));
  if (!entries.length && /^\d{1,2}$/.test(normalize(label)) && ctx.start) return [addMonths(ctx.start, +normalize(label) - 1)];
  // Months left without a year continue the chronology of the last known month.
  let previous = ctx.after ?? (ctx.start ? addMonths(ctx.start, -1) : undefined);
  const lastYear = [...entries].reverse().find((e) => e.year)?.year;
  return entries.map((e) => {
    let year = e.year;
    if (!year && previous) { const [py, pm] = previous.split('-').map(Number); year = e.month > pm ? py : py + 1; }
    if (!year) year = lastYear;
    if (!year) return null;
    previous = `${year}-${pad(e.month)}`;
    return previous;
  }).filter((m): m is string => !!m);
}

function cluster(values: number[], tolerance: number) {
  const groups: number[][] = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    const g = groups[groups.length - 1];
    if (g && v - g.reduce((s, n) => s + n, 0) / g.length <= tolerance) g.push(v); else groups.push([v]);
  }
  return groups.map((g) => g.reduce((s, n) => s + n, 0) / g.length);
}

const isFooter = (s: string) => /fundamento legal|^\s*\d{1,3}\s*$/i.test(s);
const isEnd = (s: string) => /^(palmas|local e data|_{3,}|bolsista$|documento assinado|assinatura)|\b\d{1,2} de [a-z]+ de \d{4}/.test(normalize(s));

/** Rebuilds the cronograma from PDF text items (PDF y grows upwards). */
export function scheduleFromItems(items: PositionedItem[], validity?: { start: string } | null): Schedule | null {
  // Find the section title on rebuilt lines: some PDFs emit one item per word,
  // and sentences elsewhere also mention "cronograma".
  const byLine = new Map<string, PositionedItem[]>();
  for (const t of items) { const key = `${t.page}:${Math.round(t.y)}`; byLine.set(key, [...(byLine.get(key) ?? []), t]); }
  const titleLines = [...byLine.values()].map((ts) => ({ page: ts[0].page, y: ts[0].y, text: normalize(ts.sort((a, b) => a.x - b.x).map((t) => t.s).join(' ')) }))
    .sort((a, b) => a.page - b.page || b.y - a.y);
  const title = titleLines.find((l) => /cronograma de atividades/.test(l.text)) ?? titleLines.find((l) => l.text === 'cronograma');
  if (!title) return null;
  const after = items.filter((t) => t.page > title.page || (t.page === title.page && t.y <= title.y + 1));
  const marks = after.filter((t) => isMark(t.s));
  if (!marks.length) return null;

  const firstPage = Math.min(...marks.map((t) => t.page));
  const topY = Math.max(...marks.filter((t) => t.page === firstPage).map((t) => t.y));
  const markCenters = cluster(marks.map((t) => t.x + t.w / 2), 12);
  const left = Math.min(...markCenters) - 18, right = Math.max(...markCenters) + 22;
  const mesesY = after.find((t) => t.page === firstPage && normalize(t.s) === 'meses')?.y ?? Infinity;
  const headerFrags = after.filter((t) => t.page === firstPage && t.y > topY + 3 && t.y < mesesY && t.w < 45 && t.s.trim()
    && !isMark(t.s) && t.x + t.w / 2 >= left && t.x + t.w / 2 <= right);
  const centers = cluster([...markCenters, ...headerFrags.map((t) => t.x + t.w / 2)], 12);
  const nearest = (x: number) => centers.reduce((best, c, i) => (Math.abs(c - x) < Math.abs(centers[best] - x) ? i : best), 0);

  let previous: string | undefined;
  const columns: ScheduleColumn[] = centers.map((_, i) => {
    const label = headerFrags.filter((t) => nearest(t.x + t.w / 2) === i).sort((a, b) => b.y - a.y || a.x - b.x).map((t) => t.s).join('').replace(/\s+/g, ' ').trim();
    const months = parseMonthLabel(label.replace(/(\d{2,3})\s+(\d{1,2})$/, '$1$2'), { start: validity?.start, after: previous });
    if (months.length) previous = months[months.length - 1];
    return { label, months };
  });

  // Activity column: text left of the first month column, from the first table row on.
  const activityLimit = Math.min(...centers) - 14;
  const textItems = after.filter((t) => t.page >= firstPage && t.s.trim() && t.x < activityLimit && !isFooter(t.s) && (t.page > firstPage || t.y <= topY + 30))
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Array<{ page: number; y: number; text: string }> = [];
  for (const t of textItems) {
    const line = lines[lines.length - 1];
    if (line && line.page === t.page && Math.abs(line.y - t.y) <= 2.5) line.text += ` ${t.s}`; else lines.push({ page: t.page, y: t.y, text: t.s });
  }
  type Entry = { lines: typeof lines; marks: Set<number> };
  const entries: Entry[] = [];
  let open: Entry | null = null;
  for (const line of lines) {
    line.text = line.text.replace(/\s+/g, ' ').trim();
    if (isEnd(line.text)) break;
    if (!open) { open = { lines: [], marks: new Set() }; entries.push(open); }
    open.lines.push(line);
    if (/[;.]$/.test(line.text)) open = null;
  }

  // Each row of marks belongs to the activity whose lines surround it.
  const rows = new Map<string, PositionedItem[]>();
  for (const m of marks) { const key = `${m.page}:${Math.round(m.y / 3)}`; rows.set(key, [...(rows.get(key) ?? []), m]); }
  for (const row of rows.values()) {
    const { page, y } = row[0];
    let best: Entry | null = null, distance = Infinity;
    for (const e of entries) {
      const ys = e.lines.filter((l) => l.page === page).map((l) => l.y);
      if (!ys.length) continue;
      const lo = Math.min(...ys) - 10, hi = Math.max(...ys) + 10, d = y < lo ? lo - y : y > hi ? y - hi : 0;
      if (d < distance) { distance = d; best = e; }
    }
    if (best && distance <= 20) row.forEach((m) => best!.marks.add(nearest(m.x + m.w / 2)));
  }

  const out: ScheduleRow[] = entries.map((e) => {
    const cols = [...e.marks].sort((a, b) => a - b);
    return { activity: e.lines.map((l) => l.text).join(' ').replace(/\s+([;.,])/g, '$1').trim(), columns: cols, months: [...new Set(cols.flatMap((c) => columns[c]?.months ?? []))].sort() };
  }).filter((r) => r.activity.length > 8);
  return out.length ? { columns, rows: out } : null;
}

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** Rebuilds the cronograma from the DOCX HTML produced by mammoth. */
export function scheduleFromHtml(html: string, validity?: { start: string } | null): Schedule | null {
  const titled = html.search(/cronograma\s+de\s+atividades/i);
  const headingPos = titled >= 0 ? titled : html.search(/>\s*cronograma\b/i);
  if (headingPos < 0) return null;
  const tableMatch = html.slice(Math.max(0, headingPos)).match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) return null;
  const rows = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) => [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => strip(c[1])));
  const firstData = rows.findIndex((r) => r.slice(1).some(isMark));
  if (firstData < 0) return null;
  const width = Math.max(...rows.slice(firstData).map((r) => r.length)) - 1;
  const header = [...rows.slice(0, firstData)].reverse().find((r) => r.length >= width) ?? [];
  let previous: string | undefined;
  const columns = header.slice(header.length - width).map((label) => {
    const months = parseMonthLabel(label, { start: validity?.start, after: previous });
    if (months.length) previous = months[months.length - 1];
    return { label, months };
  });
  const out = rows.slice(firstData).filter((r) => r[0] && r[0].length > 8).map((r) => {
    const cols = r.slice(1).map((c, i) => (isMark(c) ? i : -1)).filter((i) => i >= 0);
    return { activity: r[0], columns: cols, months: [...new Set(cols.flatMap((c) => columns[c]?.months ?? []))].sort() };
  });
  return out.length ? { columns, rows: out } : null;
}
