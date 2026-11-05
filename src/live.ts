'use client';

import { useEffect, useRef } from 'react';

// Live screens: one long poll per tab (paused while the tab is hidden) delivers the changes made
// by any user — a new RTP, a travel report saved, a signature — to the screens that show them.
export type LiveEvent = { projectId: string | null; entity: string; id: string; action: string };
type Sub = { entities: string[]; projectId?: string; fn: (events: LiveEvent[]) => void };

const subs = new Set<Sub>();
let running = false, last: number | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const visible = () => new Promise<void>((resolve) => {
  if (!document.hidden) return resolve();
  const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); resolve(); } };
  document.addEventListener('visibilitychange', on);
});

function dispatch(events: LiveEvent[]) {
  for (const s of subs) {
    const mine = events.filter((e) => s.entities.includes(e.entity) && (!s.projectId || !e.projectId || e.projectId === s.projectId));
    if (mine.length) s.fn(mine);
  }
}

async function loop() {
  running = true;
  while (subs.size) {
    if (document.hidden) { await visible(); continue; }
    try {
      const response = await fetch(last === null ? '/api/changes' : `/api/changes?since=${last}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) { await sleep(response.status === 401 || response.status === 403 ? 60_000 : 8_000); continue; }
      const data = await response.json() as { last: number | null; events: LiveEvent[]; unavailable?: boolean };
      if (data.unavailable) { await sleep(60_000); continue; }
      if (last !== null && data.events.length) dispatch(data.events);
      if (data.last !== null) last = data.last;
    } catch { await sleep(5_000); }
  }
  running = false;
}

/**
 * Calls onChange (debounced) when another user — or this one in another tab — changes records of
 * these kinds (table names: reports, travel_reports, documents, scholars, execution_records,
 * work_plans, meeting_minutes, signature_requests) in the project.
 */
export function useLive(entities: string[], onChange: (events: LiveEvent[]) => void, projectId?: string) {
  const callback = useRef(onChange);
  callback.current = onChange;
  const key = entities.join(',');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined, pending: LiveEvent[] = [];
    const sub: Sub = { entities: key.split(','), projectId, fn: (events) => { pending.push(...events); clearTimeout(timer); timer = setTimeout(() => { const e = pending; pending = []; callback.current(e); }, 300); } };
    subs.add(sub);
    if (!running) void loop();
    return () => { clearTimeout(timer); subs.delete(sub); };
  }, [key, projectId]);
}
