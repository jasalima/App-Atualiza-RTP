import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Plus, UserRoundCheck, UserRoundX } from 'lucide-react';
import { scholars, settings, users } from '../api';
import type { ManagedUser, Role, ScholarOverview } from '../types';
import { Drawer, Empty, Notice, PageHead, Skeleton, Tag, fmt, roleLabel, useAsync, useScope, useToast } from '../ui';

export default function SettingsPage() {
  const { data, error } = useAsync(() => settings.status(), []);
  const managed = useAsync(() => users.list(), []);
  const { projects } = useScope();
  const toast = useToast();
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[formError,setFormError]=useState('');
  const [credential,setCredential]=useState<{email:string;password:string}|null>(null);
  const [form,setForm]=useState({name:'',email:'',role:'coordinator' as Exclude<Role,'admin'>,projectId:'',scholarId:''});
  const [projectScholars,setProjectScholars]=useState<ScholarOverview[]>([]);
  useEffect(()=>{
    if(!form.projectId){setProjectScholars([]);return;}
    void scholars.list(form.projectId).then(setProjectScholars,()=>setProjectScholars([]));
  },[form.projectId]);
  const close=()=>{setOpen(false);setCredential(null);setFormError('');setForm({name:'',email:'',role:'coordinator',projectId:projects[0]?.id??'',scholarId:''});};
  const start=()=>{setForm((x)=>({...x,projectId:x.projectId||projects[0]?.id||''}));setOpen(true);};
  async function create(e:FormEvent){
    e.preventDefault();setBusy(true);setFormError('');
    try{
      const result=await users.create({...form,scholarId:form.role==='scholar'?form.scholarId:null});
      setCredential({email:form.email,password:result.temporaryPassword});
      await managed.reload();
      toast('Usuário criado. Entregue a senha temporária por um canal seguro.');
    }catch(x){setFormError((x as Error).message);}finally{setBusy(false);}
  }
  async function status(user:ManagedUser){
    const action=user.revoked?'restore':'revoke';
    if(action==='revoke'&&!window.confirm(`Revogar o acesso de ${user.name}? As políticas de segurança bloquearão os dados imediatamente.`))return;
    try{await users.setStatus(user.authUserId,action);await managed.reload();toast(action==='revoke'?'Acesso revogado.':'Acesso restaurado.');}
    catch(x){toast((x as Error).message,'crit');}
  }
  const row = (ok: boolean, title: string, detail: string, missing: string) => <li><div>{title}<small>{ok ? detail : missing}</small></div><Tag tone={ok ? 'ok' : 'crit'}>{ok ? 'Configurado' : 'Pendente'}</Tag></li>;
  return <>
    <PageHead title="Configurações" description="Administração de acessos e estado das integrações do ambiente." />
    <section className="panel" style={{marginBottom:18}}>
      <div className="panel-head"><div><h2>Usuários da aplicação</h2><p>Crie acessos com senha temporária e revogue contas sem apagar o histórico.</p></div><button className="btn btn-primary" onClick={start} disabled={!projects.length}><Plus/>Cadastrar usuário</button></div>
      {managed.error?<div className="panel-pad"><Notice tone="crit">{managed.error}</Notice></div>:managed.loading?<Skeleton/>:!managed.data?.length?<Empty title="Nenhum usuário gerenciado">Cadastre o primeiro acesso depois de criar um projeto.</Empty>:
      <div className="table-scroll"><table className="ledger users-ledger"><thead><tr><th>Usuário</th><th>Perfil</th><th>Escopo</th><th>Situação</th><th>Cadastro</th><th></th></tr></thead><tbody>
        {managed.data.map((item)=><tr key={item.authUserId}><td><b>{item.name}</b><small>{item.email}</small></td><td>{item.role?roleLabel[item.role]:'Sem vínculo'}</td><td>{item.scholarName||item.projectTitle||'Todos os projetos'}</td><td>{item.revoked?<Tag tone="crit">Revogado</Tag>:item.mustChangePassword?<Tag tone="warn">Troca pendente</Tag>:<Tag tone="ok">Ativo</Tag>}</td><td>{fmt(item.createdAt)}</td><td className="row-actions">{item.role!=='admin'&&<button className="btn btn-small" onClick={()=>void status(item)}>{item.revoked?<><UserRoundCheck/>Restaurar</>:<><UserRoundX/>Revogar</>}</button>}</td></tr>)}
      </tbody></table></div>}
    </section>
    {error ? <Notice tone="crit">{error}</Notice> : !data ? <Skeleton /> : <div className="stack">
      <section className="panel">
        <div className="panel-head"><div><h2>Infraestrutura</h2></div></div>
        <ul className="checks">
          {row(data.database, 'Banco de dados Neon Postgres', 'Conexão do servidor disponível.', 'Defina DATABASE_URL no ambiente do servidor.')}
          {row(data.auth, 'Neon Auth', 'Sessões e cookies protegidos configurados.', 'Defina NEON_AUTH_BASE_URL e NEON_AUTH_COOKIE_SECRET.')}
          {row(data.dataApi, 'Neon Data API', 'Consultas protegidas por JWT e RLS.', 'Defina NEXT_PUBLIC_NEON_DATA_API_URL e refaça o build.')}
          {row(data.storage, `Armazenamento privado (${data.bucket})`, 'Planos e evidências são guardados no bucket privado.', 'Defina AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY. Sem isso, a importação de planos falha.')}
        </ul>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Motor de redação</h2></div></div>
        <ul className="checks">
          <li><div>{data.ai.provider === 'local' ? 'Motor local por regras' : `Provedor ${data.ai.provider}${data.ai.model ? `, modelo ${data.ai.model}` : ''}`}<small>{data.ai.provider === 'local' ? 'Monta o texto apenas a partir do plano e dos registros, sem modelo de linguagem. Não reescreve nem amplia a redação.' : 'Credencial lida do ambiente do servidor.'}</small></div><Tag tone={data.ai.configured ? 'ok' : 'crit'}>{data.ai.configured ? 'Ativo' : 'Sem credencial'}</Tag></li>
        </ul>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Modelo institucional</h2><p>Formulário 9 da FAPTO, Relatório Técnico Parcial.</p></div></div>
        <div className="panel-pad" style={{ paddingTop: 8 }}>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 14 }}>
            <li>Cabeçalho: fundação, formulário e título do relatório</li>
            <li>Identificação: projeto, bolsista, vigência da bolsa e número do RTP</li>
            <li>1.1 Objetivos propostos versus objetivos alcançados</li>
            <li>1.2 Resultados esperados versus resultados obtidos</li>
            <li>2. Informações adicionais</li>
            <li>Local, data e área de assinatura do bolsista</li>
          </ol>
        </div>
      </section>
    </div>}
    <Drawer open={open} title={credential?'Credencial temporária':'Cadastrar usuário'} description={credential?'Copie agora: esta senha não será exibida novamente.':'O novo usuário deverá trocar a senha no primeiro acesso.'} onClose={close}>
      {credential?<div className="stack">
        <Notice tone="warn" title="Entrega segura">Envie a credencial diretamente ao usuário. Não use grupos ou documentos compartilhados.</Notice>
        <div className="credential"><span>E-mail</span><b>{credential.email}</b><span>Senha temporária</span><code>{credential.password}</code></div>
        <button className="btn btn-primary btn-block" onClick={()=>void navigator.clipboard.writeText(`E-mail: ${credential.email}\nSenha temporária: ${credential.password}`)}><Copy/>Copiar credencial</button>
        <button className="btn btn-block" onClick={close}>Concluir</button>
      </div>:<form className="stack" onSubmit={create}>
        <label className="field">Nome completo<input value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} required minLength={3}/></label>
        <label className="field">E-mail<input type="email" autoComplete="off" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})} required/></label>
        <label className="field">Perfil<select value={form.role} onChange={(e)=>setForm({...form,role:e.target.value as Exclude<Role,'admin'>,scholarId:''})}><option value="coordinator">Coordenação</option><option value="scholar">Bolsista</option></select></label>
        <label className="field">Projeto<select value={form.projectId} onChange={(e)=>setForm({...form,projectId:e.target.value,scholarId:''})} required><option value="">Selecione</option>{projects.map((p)=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
        {form.role==='scholar'&&<label className="field">Bolsista associado<select value={form.scholarId} onChange={(e)=>setForm({...form,scholarId:e.target.value})} required><option value="">Selecione</option>{projectScholars.map((s)=><option key={s.id} value={s.id}>{s.full_name}</option>)}</select><small>O bolsista precisa estar cadastrado previamente no projeto.</small></label>}
        {formError&&<Notice tone="crit">{formError}</Notice>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy?'Criando…':'Criar usuário e gerar senha'}</button>
      </form>}
    </Drawer>
  </>;
}
