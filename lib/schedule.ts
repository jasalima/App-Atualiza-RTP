// Month arithmetic for the individual activity schedule (cronograma). Pure and
// shared by the server (extraction, report generation) and the interface.
// A scheduled month is stored as 'YYYY-MM'.

export const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const short = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const toMonth = (date: string) => date.slice(0, 7);
export const monthStart = (m: string) => `${m}-01`;
export function monthEnd(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
}
export function addMonths(m: string, n: number) {
  const [y, mo] = m.split('-').map(Number), d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
/** Every month from the month of `start` to the month of `end`, inclusive. */
export function monthsBetween(start: string, end: string) {
  const out: string[] = [];
  for (let m = toMonth(start), last = toMonth(end); m <= last && out.length < 240; m = addMonths(m, 1)) out.push(m);
  return out;
}
export const monthLabel = (m: string) => `${short[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
export const monthLong = (m: string) => `${monthNames[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;

type Scheduled = { item_type?: string; scheduled_months?: string[] | null; starts_on?: string | null; ends_on?: string | null };

/** True when the plan foresees the item in [start, end]: by cronograma months first, then by dates. Undated items count as foreseen. */
export function isScheduledIn(item: Scheduled, start: string, end: string) {
  const months = item.scheduled_months ?? [];
  if (months.length) return months.some((m) => monthStart(m) <= end && monthEnd(m) >= start);
  const s = item.starts_on ? String(item.starts_on).slice(0, 10) : null, e = item.ends_on ? String(item.ends_on).slice(0, 10) : null;
  return (!s || s <= end) && (!e || e >= start);
}
export const hasSchedule = (item: Scheduled) => !!(item.scheduled_months?.length || item.starts_on || item.ends_on);

/** Compact description of a month list: "setembro de 2026 a novembro de 2027" or a list when there are gaps. */
export function describeMonths(months: string[]) {
  const sorted = [...new Set(months)].sort();
  if (!sorted.length) return '';
  const contiguous = sorted.every((m, i) => i === 0 || addMonths(sorted[i - 1], 1) === m);
  if (sorted.length === 1) return monthLong(sorted[0]);
  return contiguous ? `${monthLong(sorted[0])} a ${monthLong(sorted[sorted.length - 1])}` : sorted.map(monthLabel).join(', ');
}
