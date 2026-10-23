import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Activity, BookOpen, FileText, FolderKanban, LayoutGrid, LogOut, Menu, Settings, Sparkles, Users } from 'lucide-react';
import { neon } from './neon';
import { projects as projectsApi } from './api';
import type { Project, Role, User } from './types';
import { Notice, Pivot, ScopeContext, Skeleton, ToastProvider, errorText, roleLabel, useScope } from './ui';
import Dashboard from './screens/Dashboard';
import Projects from './screens/Projects';
import Scholars from './screens/Scholars';
import ScholarDetail from './screens/ScholarDetail';
import Plans from './screens/Plans';
import PlanReview from './screens/PlanReview';
import Executions from './screens/Executions';
import Generate from './screens/Generate';
import Reports from './screens/Reports';
import ReportEditor from './screens/ReportEditor';
import SettingsPage from './screens/Settings';

const rank: Record<Role, number> = { admin: 0, coordinator: 1, scholar: 2 };

function App() {
  const session = neon.auth.useSession();
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const authUser = session.data?.user;
    if (!authUser) { setUser(null); return; }
    // A person may hold several memberships; the strongest role defines the interface.
    neon.from('user_project_access').select('role,project_id,scholar_id').eq('auth_user_id', authUser.id)
      .then(({ data }: any) => {
        const best = [...(data ?? [])].sort((a: any, b: any) => rank[a.role as Role] - rank[b.role as Role])[0];
        setUser({ id: authUser.id, name: authUser.name || authUser.email, email: authUser.email, role: best?.role ?? null, projectId: best?.project_id ?? null, scholarId: best?.scholar_id ?? null });
      });
  }, [session.data]);
  const logout = useCallback(() => { void neon.auth.signOut(); setUser(null); }, []);
  if (session.isPending || (session.data?.user && !user)) return <div className="splash"><Pivot sectors={['on', 'on', 'warn', 'off', 'off']} size={64} animate label="Carregando" /></div>;
  if (!user) return <Login />;
  if (!user.role) return <NoAccess user={user} logout={logout} />;
  return <ToastProvider><Shell user={user} logout={logout} /></ToastProvider>;
}

// Aerial view of an irrigation polo: centre-pivot fields of different ages and sizes.
// Laid out like a real polo: fields never overlap, and some plots are still unirrigated.
const fields = [[14, 14, 12], [42, 14, 12], [70, 14, 12], [95, 14, 9], [27, 40, 12], [56, 40, 12], [84, 40, 12], [13, 66, 12], [41, 66, 8], [70, 66, 12], [96, 66, 9], [27, 92, 12], [56, 92, 12], [84, 92, 12]];
function Aerial() {
  return <svg className="aerial" viewBox="0 0 100 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><pattern id="rows" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(32)"><line x1="0" y1="0" x2="0" y2="2.2" stroke="#ffffff" strokeOpacity=".05" strokeWidth=".5" /></pattern></defs>
    <rect width="100" height="110" fill="url(#rows)" />
    {fields.map(([x, y, r], i) => {
      const filled = (i * 83) % 300 + 40, a = (filled - 90) * Math.PI / 180;
      return <g key={i}>
        <circle cx={x} cy={y} r={r} fill="#1d4a3c" fillOpacity=".75" />
        <path d={`M${x} ${y} L${x} ${y - r} A${r} ${r} 0 ${filled > 180 ? 1 : 0} 1 ${x + r * Math.cos(a)} ${y + r * Math.sin(a)} Z`} fill="#2e7a4e" fillOpacity=".7" />
        <line x1={x} y1={y} x2={x + r * Math.cos(a)} y2={y + r * Math.sin(a)} stroke="#e9edea" strokeOpacity=".55" strokeWidth=".35" />
        <circle cx={x} cy={y} r=".7" fill="#e9edea" fillOpacity=".7" />
      </g>;
    })}
    <rect width="100" height="110" fill="url(#fade)" />
    <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".35" stopColor="#12303a" stopOpacity="0" /><stop offset="1" stopColor="#12303a" stopOpacity=".95" /></linearGradient></defs>
  </svg>;
}

function Login() {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const result = await neon.auth.signIn.email({ email, password });
      if (result.error) {
        const e = result.error as { status?: number; code?: string; message?: string };
        const invalid = e.status === 401 || e.code === 'INVALID_EMAIL_OR_PASSWORD' || /invalid email or password/i.test(e.message ?? '');
        throw new Error(invalid ? 'E-mail ou senha incorretos. Confira maiúsculas e espaços.' : e.status === 429 ? 'Muitas tentativas. Aguarde um minuto e tente de novo.' : 'Não foi possível entrar agora. Tente de novo em instantes.');
      }
    } catch (x) { setError(errorText(x)); } finally { setBusy(false); }
  }
  return <main className="login">
    <section className="login-field">
      <Aerial />
      <h1>Relatórios Técnicos Parciais</h1>
      <p>Do Plano de Trabalho ao Formulário 9 da FAPTO, com cada afirmação ligada ao registro que a comprova.</p>
    </section>
    <section className="login-form">
      <form onSubmit={submit}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}><Pivot sectors={['on', 'on', 'on', 'warn', 'off']} size={30} /><span style={{ fontFamily: 'var(--display)', fontStretch: '80%', fontWeight: 650, fontSize: 18 }}>RTP Inteligente</span></div>
        <div><h2>Entrar</h2><p className="lead">Use o e-mail cadastrado pela coordenação do projeto.</p></div>
        <label className="field">E-mail<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="field">Senha<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></label>
        {error && <Notice tone="crit">{error}</Notice>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </section>
  </main>;
}

function NoAccess({ user, logout }: { user: User; logout: () => void }) {
  return <main className="login-form" style={{ minHeight: '100vh' }}>
    <div style={{ width: 'min(480px,100%)', display: 'grid', gap: 16 }}>
      <Pivot sectors={['off', 'off', 'off', 'off', 'off']} size={56} />
      <h2>Sua conta ainda não tem acesso a um projeto</h2>
      <p className="muted">A administração precisa vincular esta conta a um projeto e a um perfil. Envie o identificador abaixo para quem administra o sistema.</p>
      <div className="panel panel-pad"><div className="facts"><div><dt>Conta</dt><dd>{user.email}</dd></div><div><dt>Identificador</dt><dd><code>{user.id}</code></dd></div></div></div>
      <div><button className="btn" onClick={logout}><LogOut /> Sair</button></div>
    </div>
  </main>;
}

const groups = [
  { label: 'Preparar', items: [['/projects', 'Projetos', FolderKanban], ['/scholars', 'Bolsistas', Users], ['/plans', 'Planos de Trabalho', BookOpen]] },
  { label: 'Acompanhar', items: [['/executions', 'Execução das atividades', Activity]] },
  { label: 'Relatar', items: [['/generate', 'Gerar RTP', Sparkles], ['/reports', 'Relatórios', FileText]] }
] as const;

function Shell({ user, logout }: { user: User; logout: () => void }) {
  const [open, setOpen] = useState(false), [projects, setProjects] = useState<Project[]>([]), [loaded, setLoaded] = useState(false);
  const [projectId, setProjectIdState] = useState<string>(() => { try { return localStorage.getItem('rtp.project') ?? ''; } catch { return ''; } });
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const [loadError, setLoadError] = useState('');
  const reloadProjects = useCallback(async () => {
    try { setProjects(await projectsApi.list()); setLoadError(''); }
    catch (x) { setLoadError(errorText(x)); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { void reloadProjects(); }, [reloadProjects]);
  const setProjectId = (id: string) => { setProjectIdState(id); try { localStorage.setItem('rtp.project', id); } catch { /* sem armazenamento local */ } };
  const project = projects.find((p) => p.id === projectId) ?? projects.find((p) => p.id === user.projectId) ?? projects[0] ?? null;
  const canManage = user.role === 'admin' || user.role === 'coordinator';
  return <ScopeContext.Provider value={{ user, logout, projects, project, setProjectId, reloadProjects, canManage }}>
    <div className="app">
      <aside className={open ? 'rail open' : 'rail'} aria-label="Navegação principal">
        <div className="rail-brand"><Pivot sectors={['on', 'on', 'on', 'warn', 'off']} size={34} /><div><b>RTP Inteligente</b><small>FAPTO</small></div></div>
        {projects.length > 1 && <label className="field" style={{ padding: '0 6px 6px', color: '#7f9aa0', fontWeight: 400, fontSize: 12 }}>Projeto em foco
          <select value={project?.id ?? ''} onChange={(e) => setProjectId(e.target.value)} style={{ background: '#1b3f4b', borderColor: '#2a5566', color: '#fff', height: 34, fontSize: 13 }}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select></label>}
        <NavLink to="/" end><LayoutGrid />Visão geral</NavLink>
        {groups.map((g) => <div className="rail-group" key={g.label}><span>{g.label}</span>
          {g.items.filter(([to]) => canManage || !['/projects', '/plans', '/generate'].includes(to)).map(([to, label, Icon]) => <NavLink key={to} to={to}><Icon />{label}</NavLink>)}
        </div>)}
        <div className="rail-foot">
          {user.role === 'admin' && <NavLink to="/settings"><Settings />Configurações</NavLink>}
          <button onClick={logout}><LogOut />Sair</button>
          <div className="rail-user"><div><b>{user.name}</b><span>{roleLabel[user.role!]}</span></div></div>
        </div>
      </aside>
      <div className="main">
        <div className="bar"><button className="icon-btn" onClick={() => setOpen(!open)} aria-label="Abrir menu"><Menu /></button><b>RTP Inteligente</b></div>
        <main className="page">
          {/* Screens assume a project in focus: render them only after the list arrives. */}
          {!loaded ? <Skeleton /> : loadError ? <Notice tone="crit" title="Não foi possível carregar os projetos">{loadError}</Notice> :
            !project && location.pathname !== '/projects' && location.pathname !== '/settings' ? <FirstProject /> :
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/scholars" element={<Scholars />} />
              <Route path="/scholars/:id" element={<ScholarDetail />} />
              <Route path="/plans" element={<Plans />} />
              <Route path="/plans/:scholarId" element={<PlanReview />} />
              <Route path="/executions" element={<Executions />} />
              <Route path="/generate" element={<Generate />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/reports/:id" element={<ReportEditor />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>}
        </main>
      </div>
    </div>
  </ScopeContext.Provider>;
}

function FirstProject() {
  const { canManage } = useScope();
  return <div className="panel"><div className="empty">
    <Pivot sectors={['off', 'off', 'off', 'off', 'off']} size={72} />
    <b>Nenhum projeto disponível</b>
    <p>{canManage ? 'Cadastre o projeto institucional. Os dados dele preenchem o cabeçalho de todos os RTPs.' : 'Sua conta ainda não foi vinculada a um projeto. Fale com a coordenação.'}</p>
    {canManage && <NavLink className="btn btn-primary" to="/projects">Cadastrar projeto</NavLink>}
  </div></div>;
}

export default App;
