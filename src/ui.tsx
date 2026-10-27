'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import type { Project, Role, ScholarOverview, User } from './types';

/* Formatting ---------------------------------------------------------------- */
export const fmt = (d?: string | null) => d ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(d.length === 10 ? `${d}T12:00:00Z` : d)) : '—';
export const fmtPeriod = (a?: string | null, b?: string | null) => `${fmt(a)} a ${fmt(b)}`;
export const today = () => new Date().toISOString().slice(0, 10);
export const errorText = (x: unknown) => (x as Error)?.message || 'Não foi possível concluir a operação.';

export const roleLabel: Record<Role, string> = { admin: 'Administração', coordinator: 'Coordenação', scholar: 'Bolsista' };

type Tone = 'ok' | 'info' | 'warn' | 'crit' | 'mute';
const statuses: Record<string, [string, Tone]> = {
  active: ['Ativo', 'ok'], suspended: ['Suspenso', 'warn'], finished: ['Encerrado', 'mute'],
  draft: ['Rascunho', 'info'], pending_review: ['Em revisão', 'warn'], approved: ['Aprovado', 'ok'], exported: ['Exportado', 'ok'],
  completed: ['Concluída', 'ok'], in_progress: ['Em andamento', 'info'], partially_completed: ['Parcialmente concluída', 'info'],
  delayed: ['Atrasada', 'crit'], rescheduled: ['Reprogramada', 'warn'], not_started: ['Não iniciada', 'mute'], not_applicable: ['Não aplicável ao período', 'mute'],
  critical: ['Crítico', 'crit'], attention: ['Atenção', 'warn'], suggestion: ['Sugestão', 'info'],
  pending_plan: ['A conferir', 'warn'], confirmed: ['Conferido', 'ok'], replaced: ['Substituído', 'mute']
};
export const statusLabel = (s: string) => statuses[s]?.[0] ?? s;
export function Tag({ status, children, tone }: { status?: string; children?: ReactNode; tone?: Tone }) {
  const [label, t] = status ? statuses[status] ?? [status, 'mute'] : ['', 'mute'];
  return <span className="tag" data-tone={tone ?? t}>{children ?? label}</span>;
}
export const executionStatuses = ['not_started', 'in_progress', 'completed', 'partially_completed', 'delayed', 'rescheduled', 'not_applicable'];
export const itemTypes: Record<string, string> = { objective: 'Objetivo', goal: 'Meta', activity: 'Atividade', product: 'Produto', dependency: 'Dependência', indicator: 'Indicador' };
export const itemTypesPlural: Record<string, string> = { objective: 'Objetivos', goal: 'Metas', activity: 'Atividades previstas', product: 'Produtos e entregas', dependency: 'Dependências', indicator: 'Indicadores de acompanhamento' };

/* Session & project scope --------------------------------------------------- */
type Scope = { user: User; logout: () => void; projects: Project[]; project: Project | null; setProjectId: (id: string) => void; reloadProjects: () => Promise<void>; canManage: boolean };
export const ScopeContext = createContext<Scope | null>(null);
export const useScope = () => useContext(ScopeContext)!;

/* Toasts -------------------------------------------------------------------- */
type ToastItem = { id: number; text: string; tone: 'ok' | 'crit' };
const ToastContext = createContext<(text: string, tone?: 'ok' | 'crit') => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'crit' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'crit' ? 7000 : 3800);
  }, []);
  return <ToastContext.Provider value={push}>{children}
    <div className="toasts" role="status" aria-live="polite">{items.map((t) => <div className="toast" data-tone={t.tone} key={t.id}>{t.tone === 'crit' ? <AlertTriangle /> : <Check />}{t.text}</div>)}</div>
  </ToastContext.Provider>;
}

/* Layout pieces ------------------------------------------------------------- */
export function PageHead({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return <>{back}<div className="head"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="head-actions">{actions}</div>}</div></>;
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><Pivot sectors={['off', 'off', 'off', 'off', 'off']} size={56} /><b>{title}</b>{children && <p>{children}</p>}{action}</div>;
}
export const Skeleton = () => <div className="skeleton" aria-busy="true" aria-label="Carregando"><i /><i /><i /></div>;
export function Notice({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return <div className="notice" data-tone={tone}>{tone === 'ok' ? <Check /> : <AlertTriangle />}<div>{title && <b>{title}</b>}{children}</div></div>;
}

export function Drawer({ open, title, description, onClose, children }: { open: boolean; title: string; description?: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const content = ref.current?.querySelector<HTMLElement>('.drawer-body');
    const first = content?.querySelector<HTMLElement>('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])');
    (first ?? ref.current?.querySelector<HTMLElement>('button:not([disabled])'))?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); prev?.focus(); };
  }, [open]);
  if (!open) return null;
  return <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
      <div className="drawer-head"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button className="icon-btn" onClick={onClose} aria-label="Fechar"><X /></button></div>
      <div className="drawer-body">{children}</div>
    </div>
  </div>;
}

/* Pivot: campo irrigado visto de cima, um setor por etapa do ciclo do RTP ---- */
export type Sector = 'on' | 'warn' | 'off';
export const stageNames = ['Plano importado', 'Plano conferido', 'Execução registrada', 'RTP gerado', 'RTP aprovado'];

export function Pivot({ sectors, size = 72, animate = false, label }: { sectors: Sector[]; size?: number; animate?: boolean; label?: string }) {
  const c = 50, r = 46, step = 360 / sectors.length;
  const point = (deg: number) => { const a = (deg - 90) * Math.PI / 180; return `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`; };
  const reached = sectors.reduce((n, s, i) => (s !== 'off' ? i + 1 : n), 0);
  const style = { '--to': `${reached * step}deg` } as CSSProperties;
  return <svg className={animate ? 'pivot animate' : 'pivot'} viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={label ?? `${reached} de ${sectors.length} etapas`}>
    {sectors.map((s, i) => <path key={i} className={`sector ${s}`} d={`M${c} ${c} L${point(i * step)} A${r} ${r} 0 0 1 ${point((i + 1) * step)} Z`} />)}
    {size >= 40 && [r * .68, r * .36].map((t) => <circle key={t} className="track" cx={c} cy={c} r={t} />)}
    <circle className="rim" cx={c} cy={c} r={r} />
    <line className="arm" x1={c} y1={c} x2={c} y2={c - r + 2} style={style} />
    <circle className="hub" cx={c} cy={c} r={4.5} />
  </svg>;
}

export function sectorsOf(s: Pick<ScholarOverview, 'plan' | 'executions' | 'latest'>): Sector[] {
  const latest = s.latest?.status;
  return [
    s.plan ? 'on' : 'off',
    s.plan ? (s.plan.status === 'confirmed' ? 'on' : 'warn') : 'off',
    s.executions > 0 ? 'on' : 'off',
    latest ? 'on' : 'off',
    latest === 'approved' || latest === 'exported' ? 'on' : latest === 'pending_review' ? 'warn' : 'off'
  ];
}
export function nextStep(s: Pick<ScholarOverview, 'plan' | 'executions' | 'latest'>) {
  if (!s.plan) return 'Importar o Plano de Trabalho';
  if (s.plan.status !== 'confirmed') return 'Conferir o plano importado';
  if (!s.executions) return 'Registrar a execução';
  if (!s.latest) return 'Gerar o RTP';
  if (s.latest.status === 'draft') return 'Revisar o rascunho';
  if (s.latest.status === 'pending_review') return 'Aprovar o RTP';
  return 'Ciclo concluído';
}

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const sequence = useRef(0);
  const run = useCallback(() => {
    const request = ++sequence.current;
    setState((s) => ({ ...s, error: undefined, loading: true }));
    return Promise.resolve().then(load).then((data) => { if (request === sequence.current) setState({ data, loading: false }); }, (e) => { if (request === sequence.current) setState({ error: errorText(e), loading: false }); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void run(); return () => { sequence.current++; }; }, [run]);
  return { ...state, reload: run, set: (data: T) => { sequence.current++; setState({ data, loading: false }); } };
}
