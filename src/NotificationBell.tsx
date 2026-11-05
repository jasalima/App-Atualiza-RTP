'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Bell, CheckCircle2, Clock3, FilePen, PenLine, XCircle } from 'lucide-react';
import { route } from './api';

type Item = { id: string; kind: 'sign' | 'rejected' | 'waiting' | 'completed' | 'draft'; title: string; detail: string; link: string; at: string; action: boolean };
const ICON = { sign: PenLine, rejected: XCircle, waiting: Clock3, completed: CheckCircle2, draft: FilePen };
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(iso));
};

/** Bell with the person's pending actions; refreshed every minute, on focus and on navigation. */
export default function NotificationBell({ tone = 'dark', labeled = false }: { tone?: 'dark' | 'light'; labeled?: boolean }) {
  const [data, setData] = useState<{ items: Item[]; pending: number } | null>(null), [open, setOpen] = useState(false), [pos, setPos] = useState({ top: 0, left: 0 });
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), location = useLocation();
  const load = useCallback(() => { route<{ items: Item[]; pending: number }>('/notifications').then(setData, () => undefined); }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); window.addEventListener('focus', load); return () => { clearInterval(t); window.removeEventListener('focus', load); }; }, [load]);
  useEffect(() => { setOpen(false); load(); }, [location.pathname, load]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  function toggle() {
    const r = button.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(labeled ? r.right - 380 : r.left, window.innerWidth - 388)) });
    setOpen(!open); if (!open) load();
  }
  const pending = data?.pending ?? 0, items = data?.items ?? [];
  const actions = items.filter((i) => i.action), follow = items.filter((i) => !i.action);
  const row = (i: Item) => { const Icon = ICON[i.kind]; return <li key={i.id}><NavLink to={i.link} data-kind={i.kind}><Icon /><span><b>{i.title}</b><small>{i.detail}</small></span><time>{ago(i.at)}</time></NavLink></li>; };
  return <>
    <button ref={button} className={`bell bell-${tone}${labeled ? ' bell-labeled' : ''}${pending ? ' bell-alert' : ''}`} onClick={toggle} aria-expanded={open} aria-haspopup="dialog" aria-label={pending ? `Notificações: ${pending} pendência(s)` : 'Notificações'}>
      <Bell />{labeled && <span className="bell-label">Notificações</span>}{pending > 0 && <span className="bell-badge">{pending > 9 ? '9+' : pending}</span>}
    </button>
    {open && <div ref={panel} className="bell-panel" role="dialog" aria-label="Notificações" style={{ top: pos.top, left: pos.left }}>
      <header><b>Notificações</b><small>{pending ? `${pending} pendência(s) com você` : 'Nenhuma pendência com você'}</small></header>
      {!items.length ? <p className="bell-empty">Tudo em dia. Quando um documento precisar da sua assinatura, ele aparece aqui.</p> : <div className="bell-body">
        {actions.length > 0 && <><h4>Precisa de você</h4><ul>{actions.map(row)}</ul></>}
        {follow.length > 0 && <><h4>Acompanhamento</h4><ul>{follow.map(row)}</ul></>}
      </div>}
      <footer><NavLink to="/assinaturas">Ver minhas assinaturas</NavLink></footer>
    </div>}
  </>;
}
