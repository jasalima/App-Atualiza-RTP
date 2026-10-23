'use client';

import { monthLabel, monthsBetween } from '@/lib/schedule';
import type { PlanItem } from './types';

/** Months shown in the grid: the scholarship span plus any month marked outside it. */
export function gridMonths(items: PlanItem[], startsOn?: string | null, endsOn?: string | null) {
  const marked = items.flatMap((i) => i.scheduled_months ?? []);
  const all = [...marked, ...(startsOn ? [startsOn.slice(0, 7)] : []), ...(endsOn ? [endsOn.slice(0, 7)] : [])].sort();
  return all.length ? monthsBetween(`${all[0]}-01`, `${all[all.length - 1]}-01`) : [];
}

// The Formulário 29 schedule: activities by rows, months by columns grouped by year.
export function Cronograma({ items, months, period, onToggle }: { items: PlanItem[]; months: string[]; period?: [string, string]; onToggle?: (item: PlanItem, month: string) => void }) {
  if (!items.length || !months.length) return null;
  const years = months.reduce<Array<[string, number]>>((acc, m) => { const y = m.slice(0, 4), last = acc[acc.length - 1]; if (last?.[0] === y) last[1]++; else acc.push([y, 1]); return acc; }, []);
  const inPeriod = (m: string) => !!period && `${m}-01` <= period[1] && `${m}-31` >= period[0];
  return <div className="crono-wrap"><table className="crono">
    <thead>
      <tr><th rowSpan={2} className="crono-act">Atividade</th>{years.map(([y, n]) => <th key={y} colSpan={n} className="crono-year">{y}</th>)}</tr>
      <tr>{months.map((m) => <th key={m} className={inPeriod(m) ? 'crono-m in' : 'crono-m'} title={monthLabel(m)}>{monthLabel(m).slice(0, 3)}</th>)}</tr>
    </thead>
    <tbody>{items.map((item, n) => {
      const set = new Set(item.scheduled_months ?? []);
      return <tr key={item.id}>
        <td className="crono-act"><span className="crono-n">{n + 1}</span>{item.title}</td>
        {months.map((m) => {
          const on = set.has(m), cls = `${on ? 'on' : ''}${inPeriod(m) ? ' in' : ''}`.trim();
          return <td key={m} className={cls}>{onToggle
            ? <button type="button" aria-pressed={on} aria-label={`${monthLabel(m)}: ${on ? 'previsto' : 'não previsto'} para a atividade ${n + 1}`} onClick={() => onToggle(item, m)} />
            : on && <span className="sr-only">previsto</span>}</td>;
        })}
      </tr>;
    })}</tbody>
  </table></div>;
}
