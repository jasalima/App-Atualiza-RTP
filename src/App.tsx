import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  BookOpen,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileCheck2,
  FilePenLine,
  FileText,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";
import { api, download } from "./api";
import { neon } from "./neon";
import type {
  PlanItem,
  Project,
  Report,
  ReportContent,
  Scholar,
  User,
  Validation,
} from "./types";

const Auth = createContext<{
  user: User | null;
  login: (e: string, p: string) => Promise<void>;
  logout: () => void;
}>({ user: null, login: async () => {}, logout: () => {} });
const useAuth = () => useContext(Auth);
function App() {
  const session = neon.auth.useSession();
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const authUser = session.data?.user;
    if (!authUser) {
      setUser(null);
      return;
    }
    neon
      .from("user_project_access")
      .select("role,project_id,scholar_id")
      .eq("auth_user_id", authUser.id)
      .maybeSingle()
      .then(({ data }: any) =>
        setUser({
          id: authUser.id,
          name: authUser.name || authUser.email,
          email: authUser.email,
          role: data?.role || "scholar",
          projectId: data?.project_id || null,
          scholarId: data?.scholar_id || null,
        }),
      );
  }, [session.data]);
  const login = async (email: string, password: string) => {
    const result = await neon.auth.signIn.email({ email, password });
    if (result.error) throw new Error(result.error.message);
  };
  const logout = () => {
    void neon.auth.signOut();
    setUser(null);
  };
  if (session.isPending) return <Splash />;
  return (
    <Auth.Provider value={{ user, login, logout }}>
      {user ? <Shell /> : <Login />}
    </Auth.Provider>
  );
}
function Splash() {
  return (
    <div className="splash">
      <div className="brand-mark">R</div>
      <div className="loader" />
    </div>
  );
}
function Login() {
  const { login } = useAuth(),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-visual">
        <div className="visual-grid" />
        <div className="login-copy">
          <span className="eyebrow light">GESTÃO INSTITUCIONAL</span>
          <h1>Relatórios técnicos com rigor documental.</h1>
          <p>
            Do Plano de Trabalho à entrega do RTP: individualizado, rastreável e
            pronto para revisão.
          </p>
          <div className="principles">
            <span>
              <ShieldCheck /> Dados protegidos
            </span>
            <span>
              <FileCheck2 /> Evidências rastreáveis
            </span>
            <span>
              <Sparkles /> IA responsável
            </span>
          </div>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="brand">
            <div className="brand-mark">R</div>
            <div>
              <b>RTP Inteligente</b>
              <small>Gestão & Relatórios</small>
            </div>
          </div>
          <div>
            <span className="eyebrow">ACESSO SEGURO</span>
            <h2>Bem-vindo de volta</h2>
            <p className="muted">
              Entre para continuar no ambiente institucional.
            </p>
          </div>
          <label>
            E-mail institucional
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          {error && (
            <div className="alert error">
              <AlertTriangle /> {error}
            </div>
          )}
          <button className="btn primary full" disabled={busy}>
            {busy ? "Autenticando…" : "Entrar no sistema"} <ChevronRight />
          </button>
          <small className="security-note">
            <ShieldCheck /> Acesso monitorado e protegido por auditoria.
          </small>
        </form>
      </section>
    </main>
  );
}
const nav = [
  ["/", "Visão geral", LayoutDashboard],
  ["/projects", "Projetos", BriefcaseBusiness],
  ["/scholars", "Bolsistas", Users],
  ["/plans", "Planos de Trabalho", BookOpen],
  ["/executions", "Execução das Atividades", Activity],
  ["/generate", "Gerar RTP", Sparkles],
  ["/reports", "Relatórios", FileText],
] as const;
function Shell() {
  const { user, logout } = useAuth(),
    [open, setOpen] = useState(false);
  return (
    <div className="app">
      <aside className={open ? "sidebar open" : "sidebar"}>
        <div className="brand inverse">
          <div className="brand-mark">R</div>
          <div>
            <b>RTP Inteligente</b>
            <small>Gestão & Relatórios</small>
          </div>
        </div>
        <nav>
          {nav.map(([to, label, Icon]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => setOpen(false)}
            >
              <Icon />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <NavLink to="/settings">
            <Settings />
            Configurações
          </NavLink>
          <button onClick={logout}>
            <LogOut />
            Sair
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button className="icon-btn mobile" onClick={() => setOpen(!open)}>
            <Menu />
          </button>
          <div className="crumb">
            Sistema de Gestão <ChevronRight /> <b>FAPTO</b>
          </div>
          <div className="user">
            <div className="avatar">{user?.name.slice(0, 2).toUpperCase()}</div>
            <div>
              <b>{user?.name}</b>
              <small>{roleLabel(user!.role)}</small>
            </div>
          </div>
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/scholars" element={<Scholars />} />
            <Route path="/scholars/:id" element={<ScholarDetail />} />
            <Route path="/plans" element={<Plans />} />
            <Route path="/executions" element={<Executions />} />
            <Route path="/generate" element={<Generate />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/:id" element={<ReportEditor />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
const roleLabel = (r: string) =>
  ({ admin: "Administrador", coordinator: "Coordenador", scholar: "Bolsista" })[
    r
  ] || r;
const fmt = (d: string) =>
  d
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(d))
    : "—";
const statusLabel = (s: string) =>
  ({
    active: "Ativo",
    draft: "Rascunho",
    pending_review: "Em revisão",
    approved: "Aprovado",
    exported: "Exportado",
    completed: "Concluída",
    in_progress: "Em andamento",
    partially_completed: "Parcial",
    delayed: "Atrasada",
    rescheduled: "Reprogramada",
    not_started: "Não iniciada",
    not_applicable: "Não aplicável",
  })[s] || s;
function PageHead({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
function Dashboard() {
  const [data, setData] = useState<any>();
  useEffect(() => {
    api("/dashboard").then(setData);
  }, []);
  if (!data) return <Skeleton />;
  const cards = [
    ["Bolsistas ativos", data.scholars.active, Users, "green"],
    ["Planos cadastrados", data.plans, BookOpen, "blue"],
    ["Em elaboração", data.reports.draft || 0, FilePenLine, "amber"],
    [
      "Aguardando revisão",
      data.reports.pending_review || 0,
      ClipboardCheck,
      "purple",
    ],
  ];
  return (
    <>
      <PageHead
        eyebrow="PAINEL INSTITUCIONAL"
        title="Visão geral"
        description="Acompanhe o ciclo dos relatórios e as pendências que exigem atenção."
        action={
          <NavLink className="btn primary" to="/generate">
            <Sparkles /> Gerar novo RTP
          </NavLink>
        }
      />
      <section className="stats">
        {cards.map(([label, value, Icon, color]: any) => (
          <article className="stat" key={label}>
            <div className={`stat-icon ${color}`}>
              <Icon />
            </div>
            <div>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
            <small>Dados confirmados no sistema</small>
          </article>
        ))}
      </section>
      <section className="grid two">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Relatórios recentes</h3>
              <p>Últimas movimentações do projeto</p>
            </div>
            <NavLink to="/reports">Ver todos</NavLink>
          </div>
          {data.recent.length ? (
            <div className="list">
              {data.recent.map((r: Report) => (
                <NavLink
                  to={`/reports/${r.id}`}
                  className="list-row"
                  key={r.id}
                >
                  <div className="file-icon">
                    <FileText />
                  </div>
                  <div className="grow">
                    <b>{r.scholar_name}</b>
                    <span>
                      RTP {r.number} · {fmt(r.period_start)}–{fmt(r.period_end)}
                    </span>
                  </div>
                  <Badge status={r.status} />
                  <ChevronRight />
                </NavLink>
              ))}
            </div>
          ) : (
            <Empty icon={FileText} text="Nenhum relatório gerado ainda." />
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Fluxo de trabalho</h3>
              <p>Próximos passos recomendados</p>
            </div>
          </div>
          <div className="flow">
            <Flow
              n="01"
              title="Importe os planos"
              text="Extraia e confira as atribuições individuais."
              done={data.plans > 0}
            />
            <Flow
              n="02"
              title="Registre a execução"
              text="Informe atividades e evidências do período."
            />
            <Flow
              n="03"
              title="Gere e valide"
              text="Revise os achados antes da aprovação."
            />
          </div>
        </div>
      </section>
    </>
  );
}
function Flow({
  n,
  title,
  text,
  done,
}: {
  n: string;
  title: string;
  text: string;
  done?: boolean;
}) {
  return (
    <div className="flow-row">
      <span className={done ? "done" : ""}>{done ? <Check /> : n}</span>
      <div>
        <b>{title}</b>
        <p>{text}</p>
      </div>
    </div>
  );
}
function Badge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{statusLabel(status)}</span>;
}
function Empty({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="empty">
      <Icon />
      <b>{text}</b>
      <span>As informações aparecerão aqui quando forem cadastradas.</span>
    </div>
  );
}
function Skeleton() {
  return (
    <div className="skeleton">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

function useProjects() {
  const [data, setData] = useState<Project[]>([]);
  useEffect(() => {
    api<Project[]>("/projects").then(setData);
  }, []);
  return [data, setData] as const;
}
function Projects() {
  const [projects, setProjects] = useProjects(),
    [show, setShow] = useState(false);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      body = Object.fromEntries(f);
    try {
      const p = await api<Project>("/projects", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setProjects([p, ...projects]);
      setShow(false);
    } catch (x) {
      alert((x as Error).message);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="CONFIGURAÇÃO"
        title="Projetos"
        description="Dados institucionais que alimentam automaticamente os relatórios."
        action={
          <button className="btn primary" onClick={() => setShow(true)}>
            <Plus /> Novo projeto
          </button>
        }
      />
      {projects.length ? (
        <div className="cards-grid">
          {projects.map((p) => (
            <article className="project-card" key={p.id}>
              <div className="project-top">
                <div className="project-symbol">
                  <BriefcaseBusiness />
                </div>
                <Badge status={p.status} />
              </div>
              <h3>{p.title}</h3>
              <p>{p.executing_institution}</p>
              <dl>
                <div>
                  <dt>Coordenação</dt>
                  <dd>{p.coordinator}</dd>
                </div>
                <div>
                  <dt>Vigência</dt>
                  <dd>
                    {fmt(p.starts_on)} — {fmt(p.ends_on)}
                  </dd>
                </div>
                <div>
                  <dt>Emissão</dt>
                  <dd>{p.city}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <Empty icon={BriefcaseBusiness} text="Nenhum projeto cadastrado." />
      )}
      <Modal open={show} close={() => setShow(false)} title="Cadastrar projeto">
        <form className="form-grid" onSubmit={create}>
          <label className="wide">
            Título do projeto
            <input name="title" required minLength={5} />
          </label>
          <label>
            Instituição executora
            <input name="executingInstitution" required />
          </label>
          <label>
            Fundação de apoio
            <input
              name="supportFoundation"
              defaultValue="Fundação de Apoio Científico e Tecnológico do Tocantins – FAPTO"
            />
          </label>
          <label>
            Coordenador geral
            <input name="coordinator" required />
          </label>
          <label>
            Município de emissão
            <input name="city" defaultValue="Palmas – TO" />
          </label>
          <label>
            Data de início
            <input name="startsOn" type="date" required />
          </label>
          <label>
            Data de encerramento
            <input name="endsOn" type="date" required />
          </label>
          <label className="wide">
            Descrição
            <textarea name="description" />
          </label>
          <label className="wide">
            Objetivo geral
            <textarea name="generalObjective" />
          </label>
          <div className="modal-actions wide">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setShow(false)}
            >
              Cancelar
            </button>
            <button className="btn primary">Salvar projeto</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
function Scholars() {
  const [projects] = useProjects(),
    [project, setProject] = useState(""),
    [list, setList] = useState<Scholar[]>([]),
    [show, setShow] = useState(false),
    [search, setSearch] = useState("");
  useEffect(() => {
    if (!project && projects[0]) setProject(projects[0].id);
  }, [projects, project]);
  useEffect(() => {
    if (project) api<Scholar[]>(`/scholars?projectId=${project}`).then(setList);
  }, [project]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      body = { ...Object.fromEntries(f), projectId: project };
    try {
      const s = await api<Scholar>("/scholars", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setList([...list, s]);
      setShow(false);
    } catch (x) {
      alert((x as Error).message);
    }
  }
  const filtered = list.filter((s) =>
    s.full_name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHead
        eyebrow="GESTÃO DE PESSOAS"
        title="Bolsistas"
        description="Perfis, atribuições e histórico individual preservados por projeto."
        action={
          <button
            className="btn primary"
            disabled={!project}
            onClick={() => setShow(true)}
          >
            <Plus /> Novo bolsista
          </button>
        }
      />
      <div className="toolbar">
        <label className="search">
          <Search />
          <input
            placeholder="Buscar por nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          {projects.map((p) => (
            <option value={p.id} key={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Bolsista</th>
              <th>Área de atuação</th>
              <th>Plano de Trabalho</th>
              <th>Vigência</th>
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td>
                  <NavLink className="person" to={`/scholars/${s.id}`}>
                    <span>{s.full_name.slice(0, 2).toUpperCase()}</span>
                    <b>{s.full_name}</b>
                  </NavLink>
                </td>
                <td>{s.role_area || "Não informada"}</td>
                <td>
                  {s.has_plan ? (
                    <span className="inline-ok">
                      <Check /> Importado
                    </span>
                  ) : (
                    <span className="muted">Pendente</span>
                  )}
                </td>
                <td>
                  {fmt(s.starts_on)} — {fmt(s.ends_on)}
                </td>
                <td>
                  <Badge status={s.status} />
                </td>
                <td>
                  <NavLink className="icon-btn" to={`/scholars/${s.id}`}>
                    <ChevronRight />
                  </NavLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <Empty icon={Users} text="Nenhum bolsista encontrado." />
        )}
      </div>
      <Modal
        open={show}
        close={() => setShow(false)}
        title="Cadastrar bolsista"
      >
        <form className="form-grid" onSubmit={create}>
          <label className="wide">
            Nome completo
            <input name="fullName" required />
          </label>
          <label>
            Função ou área
            <input name="roleArea" />
          </label>
          <label>
            Modalidade da bolsa
            <input name="scholarshipType" />
          </label>
          <label>
            Vigência inicial
            <input name="startsOn" type="date" required />
          </label>
          <label>
            Vigência final
            <input name="endsOn" type="date" required />
          </label>
          <label>
            Situação
            <select name="status">
              <option value="active">Ativo</option>
              <option value="suspended">Suspenso</option>
              <option value="finished">Encerrado</option>
            </select>
          </label>
          <label className="wide">
            Observações
            <textarea name="notes" />
          </label>
          <div className="modal-actions wide">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setShow(false)}
            >
              Cancelar
            </button>
            <button className="btn primary">Salvar bolsista</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
function ScholarDetail() {
  const { id } = useParams(),
    [data, setData] = useState<any>();
  useEffect(() => {
    api(`/scholars/${id}`).then(setData);
  }, [id]);
  if (!data) return <Skeleton />;
  const s: Scholar = data.scholar;
  const groups = (data.planItems as PlanItem[]).reduce<
    Record<string, PlanItem[]>
  >((all, item) => {
    (all[item.item_type] ??= []).push(item);
    return all;
  }, {});
  return (
    <>
      <NavLink to="/scholars" className="back">
        <ArrowLeft /> Voltar aos bolsistas
      </NavLink>
      <div className="profile-head">
        <div className="profile-avatar">
          {s.full_name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <span className="eyebrow">PERFIL DO BOLSISTA</span>
          <h1>{s.full_name}</h1>
          <p>
            {s.role_area || "Área de atuação não informada"} ·{" "}
            {s.scholarship_type || "Modalidade não informada"}
          </p>
        </div>
        <Badge status={s.status} />
      </div>
      <div className="grid three">
        <Metric
          label="Vigência"
          value={`${fmt(s.starts_on)} — ${fmt(s.ends_on)}`}
        />
        <Metric label="Itens do plano" value={String(data.planItems.length)} />
        <Metric label="Relatórios" value={String(data.reports.length)} />
      </div>
      <section className="card section">
        <div className="card-head">
          <div>
            <h3>Plano de Trabalho individual</h3>
            <p>Informações estruturadas e vinculadas à fonte documental</p>
          </div>
          <NavLink className="btn secondary" to="/plans">
            <Upload /> Importar plano
          </NavLink>
        </div>
        {data.planItems.length ? (
          <div className="plan-groups">
            {Object.entries(groups).map(([type, items]) => (
              <div key={type}>
                <h4>
                  {(
                    {
                      objective: "Objetivos",
                      activity: "Atividades",
                      goal: "Metas",
                      product: "Produtos",
                      dependency: "Dependências",
                      indicator: "Indicadores",
                    } as any
                  )[type] || type}
                </h4>
                {items.map((x) => (
                  <p key={x.id}>
                    <Check /> {x.title}
                  </p>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <Empty icon={BookOpen} text="Plano ainda não importado." />
        )}
      </section>
    </>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Plans() {
  const [projects] = useProjects(),
    [project, setProject] = useState(""),
    [scholars, setScholars] = useState<Scholar[]>([]),
    [scholar, setScholar] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [result, setResult] = useState<any[]>([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!project && projects[0]) setProject(projects[0].id);
  }, [projects, project]);
  useEffect(() => {
    if (project)
      api<Scholar[]>(`/scholars?projectId=${project}`).then((x) => {
        setScholars(x);
        if (x[0]) setScholar(x[0].id);
      });
  }, [project]);
  async function upload() {
    if (!files.length || !scholar) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("projectId", project);
    fd.set("scholarId", scholar);
    files.forEach((f) => fd.append("files", f));
    try {
      setResult(await api("/plans/import", { method: "POST", body: fd }));
      setFiles([]);
    } catch (x) {
      alert((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="INTELIGÊNCIA DOCUMENTAL"
        title="Planos de Trabalho"
        description="Importe documentos, confira a extração e preserve a origem de cada atribuição."
      />
      <div className="stepper">
        <span className="active">
          <i>1</i> Selecionar
        </span>
        <b />
        <span>
          <i>2</i> Interpretar
        </span>
        <b />
        <span>
          <i>3</i> Conferir
        </span>
        <b />
        <span>
          <i>4</i> Confirmar
        </span>
      </div>
      <div className="grid plan-layout">
        <section className="card section">
          <h3>Vinculação do documento</h3>
          <p className="muted">O plano será isolado no perfil selecionado.</p>
          <label>
            Projeto
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bolsista
            <select
              value={scholar}
              onChange={(e) => setScholar(e.target.value)}
            >
              {scholars.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          </label>
          <div className="privacy">
            <ShieldCheck />
            <div>
              <b>Isolamento garantido</b>
              <span>
                O conteúdo será associado exclusivamente a este bolsista.
              </span>
            </div>
          </div>
        </section>
        <section className="card section">
          <h3>Arquivos do Plano de Trabalho</h3>
          <p className="muted">PDF e DOCX, até 20 MB por arquivo.</p>
          <label className="dropzone">
            <Upload />
            <b>Arraste arquivos ou clique para selecionar</b>
            <span>Você pode importar vários documentos</span>
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </label>
          {files.map((f) => (
            <div className="selected-file" key={f.name}>
              <FileText />
              <div>
                <b>{f.name}</b>
                <span>{(f.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              <button onClick={() => setFiles(files.filter((x) => x !== f))}>
                <X />
              </button>
            </div>
          ))}
          <button
            className="btn primary full"
            disabled={!files.length || busy}
            onClick={upload}
          >
            {busy ? "Extraindo e estruturando…" : "Importar e interpretar"}{" "}
            <Sparkles />
          </button>
        </section>
      </div>
      {result.length > 0 && (
        <div className="alert success">
          <Check />{" "}
          {result
            .map((x) => `${x.file}: ${x.itemCount} itens identificados`)
            .join(" · ")}
          . Revise o perfil do bolsista antes de usar na geração.
        </div>
      )}
    </>
  );
}
function Executions() {
  const [projects] = useProjects(),
    [project, setProject] = useState(""),
    [scholars, setScholars] = useState<Scholar[]>([]),
    [scholar, setScholar] = useState(""),
    [items, setItems] = useState<PlanItem[]>([]),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!project && projects[0]) setProject(projects[0].id);
  }, [projects, project]);
  useEffect(() => {
    if (project)
      api<Scholar[]>(`/scholars?projectId=${project}`).then((x) => {
        setScholars(x);
        setScholar(x[0]?.id || "");
      });
  }, [project]);
  useEffect(() => {
    if (scholar)
      api<any>(`/scholars/${scholar}`).then((x) =>
        setItems(
          x.planItems.filter((i: PlanItem) => i.item_type === "activity"),
        ),
      );
  }, [scholar]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      o = Object.fromEntries(f),
      plan = items.find((i) => i.id === o.planItemId);
    try {
      await api("/executions", {
        method: "POST",
        body: JSON.stringify({
          ...o,
          projectId: project,
          scholarId: scholar,
          plannedActivity: plan?.title || "",
          planItemId: o.planItemId || null,
          executionStart: o.executionStart || null,
          executionEnd: o.executionEnd || null,
        }),
      });
      setSaved(true);
      e.currentTarget.reset();
    } catch (x) {
      alert((x as Error).message);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="ACOMPANHAMENTO"
        title="Execução das atividades"
        description="Registre somente fatos confirmados; o planejamento não será tratado como execução."
      />
      <form className="card section form-grid execution-form" onSubmit={save}>
        <div className="form-section wide">
          <i>01</i>
          <div>
            <h3>Contexto do registro</h3>
            <p>Identifique o bolsista e o período de referência.</p>
          </div>
        </div>
        <label>
          Projeto
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bolsista
          <select value={scholar} onChange={(e) => setScholar(e.target.value)}>
            {scholars.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Período inicial
          <input name="periodStart" type="date" required />
        </label>
        <label>
          Período final
          <input name="periodEnd" type="date" required />
        </label>
        <div className="form-section wide">
          <i>02</i>
          <div>
            <h3>Execução confirmada</h3>
            <p>
              Relacione o registro a uma atividade prevista quando aplicável.
            </p>
          </div>
        </div>
        <label className="wide">
          Atividade prevista
          <select name="planItemId">
            <option value="">Registro não vinculado</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </select>
        </label>
        <label className="wide">
          Atividade efetivamente executada
          <textarea
            name="executedActivity"
            required
            placeholder="Descreva objetivamente o que foi realizado…"
          />
        </label>
        <label>
          Início da execução
          <input name="executionStart" type="date" />
        </label>
        <label>
          Fim da execução
          <input name="executionEnd" type="date" />
        </label>
        <label>
          Situação
          <select name="status" required>
            <option value="in_progress">Em andamento</option>
            <option value="completed">Concluída</option>
            <option value="partially_completed">Parcialmente concluída</option>
            <option value="delayed">Atrasada</option>
            <option value="rescheduled">Reprogramada</option>
            <option value="not_started">Não iniciada</option>
            <option value="not_applicable">Não aplicável</option>
          </select>
        </label>
        <label>
          Produto gerado
          <input name="product" />
        </label>
        <label className="wide">
          Resultado observado
          <textarea name="result" />
        </label>
        <label>
          Dificuldades encontradas
          <textarea name="difficulties" />
        </label>
        <label>
          Providências adotadas
          <textarea name="actionsTaken" />
        </label>
        <label className="wide">
          Observações
          <textarea name="notes" />
        </label>
        {saved && (
          <div className="alert success wide">
            <Check /> Registro salvo e disponível para a próxima geração.
          </div>
        )}
        <div className="modal-actions wide">
          <button className="btn primary">
            <Check /> Salvar execução
          </button>
        </div>
      </form>
    </>
  );
}
function Generate() {
  const nav = useNavigate(),
    [projects] = useProjects(),
    [project, setProject] = useState(""),
    [scholars, setScholars] = useState<Scholar[]>([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!project && projects[0]) setProject(projects[0].id);
  }, [projects, project]);
  useEffect(() => {
    if (project)
      api<Scholar[]>(`/scholars?projectId=${project}`).then(setScholars);
  }, [project]);
  async function generate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const body = {
      ...Object.fromEntries(new FormData(e.currentTarget)),
      projectId: project,
    };
    try {
      const r = await api<Report>("/reports/generate", {
        method: "POST",
        body: JSON.stringify(body),
      });
      nav(`/reports/${r.id}`);
    } catch (x) {
      alert((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="GERAÇÃO ASSISTIDA"
        title="Gerar Relatório Técnico Parcial"
        description="O conteúdo será confrontado com o plano, os registros e as evidências do período."
      />
      <div className="generator-grid">
        <form className="card section form-grid" onSubmit={generate}>
          <div className="form-section wide">
            <i>01</i>
            <div>
              <h3>Identificação</h3>
              <p>Defina o titular e a referência institucional.</p>
            </div>
          </div>
          <label className="wide">
            Projeto
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Bolsista
            <select name="scholarId" required>
              {scholars.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            RTP nº
            <input name="number" placeholder="01/2026" required />
          </label>
          <label>
            Data de emissão
            <input
              name="issuedOn"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
          </label>
          <div className="form-section wide">
            <i>02</i>
            <div>
              <h3>Período e redação</h3>
              <p>
                Apenas execuções compreendidas no intervalo serão consideradas.
              </p>
            </div>
          </div>
          <label>
            Período inicial
            <input name="periodStart" type="date" required />
          </label>
          <label>
            Período final
            <input name="periodEnd" type="date" required />
          </label>
          <label className="wide">
            Extensão
            <select name="lengthMode" defaultValue="standard">
              <option value="concise">Sintético</option>
              <option value="standard">Padrão institucional</option>
              <option value="detailed">Detalhado</option>
            </select>
          </label>
          <button
            className="btn primary full wide"
            disabled={busy || !scholars.length}
          >
            {busy
              ? "Analisando documentos e registros…"
              : "Gerar versão preliminar"}{" "}
            <Sparkles />
          </button>
        </form>
        <aside className="generation-info">
          <ShieldCheck />
          <h3>Geração responsável</h3>
          <p>
            A plataforma nunca transforma uma atividade planejada em realizada
            sem confirmação.
          </p>
          <ul>
            <li>
              <Check /> Seleção temporal
            </li>
            <li>
              <Check /> Separação por bolsista
            </li>
            <li>
              <Check /> Validação de evidências
            </li>
            <li>
              <Check /> Referências para auditoria
            </li>
          </ul>
          <div className="note">
            <AlertTriangle /> Lacunas serão marcadas como pendências, não
            preenchidas pela IA.
          </div>
        </aside>
      </div>
    </>
  );
}

function Reports() {
  const [projects] = useProjects(),
    [project, setProject] = useState(""),
    [list, setList] = useState<Report[]>([]);
  useEffect(() => {
    if (!project && projects[0]) setProject(projects[0].id);
  }, [projects, project]);
  useEffect(() => {
    if (project) api<Report[]>(`/reports?projectId=${project}`).then(setList);
  }, [project]);
  return (
    <>
      <PageHead
        eyebrow="ACERVO TÉCNICO"
        title="Relatórios"
        description="Histórico individual, versões, validações e exportações."
        action={
          <NavLink className="btn primary" to="/generate">
            <Plus /> Gerar RTP
          </NavLink>
        }
      />
      <div className="toolbar">
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Relatório</th>
              <th>Bolsista</th>
              <th>Período</th>
              <th>Emissão</th>
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td>
                  <NavLink to={`/reports/${r.id}`}>
                    <b>RTP {r.number}</b>
                  </NavLink>
                </td>
                <td>{r.scholar_name}</td>
                <td>
                  {fmt(r.period_start)} — {fmt(r.period_end)}
                </td>
                <td>{fmt(r.issued_on)}</td>
                <td>
                  <Badge status={r.status} />
                </td>
                <td>
                  <NavLink className="icon-btn" to={`/reports/${r.id}`}>
                    <ChevronRight />
                  </NavLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && (
          <Empty icon={Archive} text="Nenhum relatório no acervo." />
        )}
      </div>
    </>
  );
}
function ReportEditor() {
  const { id } = useParams(),
    [report, setReport] = useState<Report | null>(null),
    [content, setContent] = useState<ReportContent | null>(null),
    [tab, setTab] = useState<"document" | "validation" | "history">("document"),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    api<Report>(`/reports/${id}`).then((r) => {
      setReport(r);
      setContent(r.content!);
    });
  }, [id]);
  if (!report || !content) return <Skeleton />;
  async function save() {
    await api(`/reports/${id}/content`, {
      method: "PUT",
      body: JSON.stringify({
        content,
        changeSummary: "Revisão manual no editor",
      }),
    });
    setSaved(true);
  }
  async function approve() {
    try {
      await api(`/reports/${id}/approve`, { method: "POST" });
      setReport((previous) =>
        previous ? { ...previous, status: "approved" } : previous,
      );
    } catch (x) {
      alert((x as Error).message);
    }
  }
  const critical =
    report.validations?.filter(
      (v) => v.severity === "critical" && !("resolved_at" in v),
    ) || [];
  return (
    <>
      <div className="editor-head">
        <div>
          <NavLink to="/reports" className="back">
            <ArrowLeft /> Relatórios
          </NavLink>
          <h1>RTP {report.number}</h1>
          <p>
            {report.scholar_name} · {fmt(report.period_start)} a{" "}
            {fmt(report.period_end)}
          </p>
        </div>
        <div className="editor-actions">
          <Badge status={report.status} />
          <button className="btn secondary" onClick={save}>
            <FileCheck2 /> Salvar versão
          </button>
          <button
            className="btn primary"
            onClick={approve}
            disabled={critical.length > 0 || report.status === "approved"}
          >
            <Check /> Aprovar
          </button>
        </div>
      </div>
      {saved && (
        <div className="alert success">
          <Check /> Nova versão salva no histórico.
        </div>
      )}
      <div className="tabs">
        <button
          className={tab === "document" ? "active" : ""}
          onClick={() => setTab("document")}
        >
          <FileText /> Documento
        </button>
        <button
          className={tab === "validation" ? "active" : ""}
          onClick={() => setTab("validation")}
        >
          <ShieldCheck /> Validação <em>{report.validations?.length || 0}</em>
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          <Archive /> Versões
        </button>
      </div>
      {tab === "document" && (
        <div className="editor-layout">
          <article className="paper">
            <header>
              <b>{content.heading.foundation}</b>
              <b>{content.heading.form}</b>
              <h2>{content.heading.title}</h2>
            </header>
            <div className="id-table">
              <div>
                <b>Título do Projeto:</b>
                <span>{content.heading.project}</span>
              </div>
              <div>
                <b>Bolsista:</b>
                <span>{content.heading.scholar}</span>
              </div>
              <div>
                <b>Vigência da Bolsa:</b>
                <span>{content.heading.scholarshipPeriod}</span>
              </div>
              <div>
                <b>RTP Nº:</b>
                <span>{content.heading.number}</span>
              </div>
            </div>
            <h3>1. RESULTADOS PARCIAIS</h3>
            <Editable
              title="1.1 Objetivos propostos no plano individual versus objetivos alcançados"
              value={content.sections.results}
              set={(v) =>
                setContent({
                  ...content,
                  sections: { ...content.sections, results: v },
                })
              }
            />
            <Editable
              title="1.2 Resultados esperados versus resultados obtidos"
              value={content.sections.comparison}
              set={(v) =>
                setContent({
                  ...content,
                  sections: { ...content.sections, comparison: v },
                })
              }
            />
            <Editable
              title="2. INFORMAÇÕES ADICIONAIS"
              value={content.sections.additional}
              set={(v) =>
                setContent({
                  ...content,
                  sections: { ...content.sections, additional: v },
                })
              }
            />
            <div className="signature">
              <p>{content.closing.placeAndDate}</p>
              <i />
              <b>{content.closing.scholar}</b>
              <span>{content.closing.role}</span>
            </div>
          </article>
          <aside className="export-card">
            <h3>Exportar documento</h3>
            <p>Arquivos institucionais com paginação e área de assinatura.</p>
            <button
              className="btn secondary full"
              onClick={() =>
                download(
                  `/reports/${id}/export/docx`,
                  `RTP-${report.number}.docx`,
                )
              }
            >
              <Download /> Documento editável (.docx)
            </button>
            <button
              className="btn secondary full"
              onClick={() =>
                download(
                  `/reports/${id}/export/pdf`,
                  `RTP-${report.number}.pdf`,
                )
              }
            >
              <Download /> Documento final (.pdf)
            </button>
            {content.pending.length > 0 && (
              <div className="note">
                <AlertTriangle />
                <div>
                  <b>{content.pending.length} pendência(s)</b>
                  <span>Confira antes da aprovação.</span>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
      {tab === "validation" && (
        <ValidationPanel items={report.validations || []} />
      )}{" "}
      {tab === "history" && (
        <div className="card section">
          <h3>Histórico imutável de versões</h3>
          <div className="timeline">
            {report.versions?.map((v) => (
              <div key={v.version}>
                <span>v{v.version}</span>
                <div>
                  <b>{v.change_summary}</b>
                  <p>{new Date(v.created_at).toLocaleString("pt-BR")}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
function Editable({
  title,
  value,
  set,
}: {
  title: string;
  value: string;
  set: (v: string) => void;
}) {
  return (
    <section className="editable">
      <h3>{title}</h3>
      <textarea value={value} onChange={(e) => set(e.target.value)} />
    </section>
  );
}
function ValidationPanel({ items }: { items: Validation[] }) {
  return (
    <div className="card section">
      <div className="card-head">
        <div>
          <h3>Validação automática</h3>
          <p>Consistência documental, temporal, funcional e textual.</p>
        </div>
      </div>
      {items.length ? (
        <div className="findings">
          {items.map((v, i) => (
            <div className={`finding ${v.severity}`} key={v.id || i}>
              <AlertTriangle />
              <div>
                <b>{v.message}</b>
                <span>
                  {v.location} · {v.code}
                </span>
              </div>
              <Badge status={v.severity} />
            </div>
          ))}
        </div>
      ) : (
        <div className="alert success">
          <Check /> Nenhuma inconsistência foi identificada nesta versão.
        </div>
      )}
    </div>
  );
}
function SettingsPage() {
  return (
    <>
      <PageHead
        eyebrow="ADMINISTRAÇÃO"
        title="Configurações"
        description="Integrações e políticas operacionais do ambiente."
      />
      <div className="grid two">
        <div className="card section">
          <div className="setting-icon">
            <Sparkles />
          </div>
          <h3>Provedor de inteligência artificial</h3>
          <p className="muted">
            Configurado exclusivamente por variáveis de ambiente no servidor.
            Credenciais nunca são expostas ao navegador.
          </p>
          <Badge status="active" />
        </div>
        <div className="card section">
          <div className="setting-icon">
            <ShieldCheck />
          </div>
          <h3>Segurança e auditoria</h3>
          <p className="muted">
            Permissões aplicadas no backend, documentos privados e eventos
            relevantes registrados.
          </p>
          <Badge status="active" />
        </div>
      </div>
    </>
  );
}
function Modal({
  open,
  close,
  title,
  children,
}: {
  open: boolean;
  close: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={close}>
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default App;
