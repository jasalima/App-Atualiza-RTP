'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { scholars, users, route } from './api';
import type { ManagedUser, Role, ScholarOverview } from './types';
import { GRANTABLE, MODULES, PROFILE_MODULES, type ModuleKey } from '@/lib/modules-catalog';
import { Drawer, Notice, Skeleton, errorText, roleLabel } from './ui';

/** Modules of an account: what the profile includes and, highlighted, what was enabled. */
export function ModuleChips({ role, extra }: { role: Role | null; extra: string[] }) {
  if (!role) return <span className="muted">—</span>;
  const own = PROFILE_MODULES[role] ?? [];
  const added = extra.filter((m) => !own.includes(m as ModuleKey));
  return <div className="module-chips">
    {role === 'admin' || role === 'coordinator' ? <span className="module-chip">Todos os módulos</span> : own.map((m) => <span key={m} className="module-chip">{MODULES[m].label}</span>)}
    {added.map((m) => <span key={m} className="module-chip module-chip-on" title="Habilitado pela administração">+ {MODULES[m as ModuleKey]?.label ?? m}</span>)}
  </div>;
}

/** Administration edits the extra modules and the member record of an account in its project. */
export default function AccessDrawer({ user, onClose, onSaved }: { user: ManagedUser; onClose: () => void; onSaved: (message: string) => void | Promise<void> }) {
  const role = user.role!, own = PROFILE_MODULES[role] ?? [];
  const [modules, setModules] = useState<string[]>(user.modules ?? []), [scholarId, setScholarId] = useState(user.scholarId ?? '');
  const [members, setMembers] = useState<ScholarOverview[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [identity, setIdentity] = useState({ cpf: '', phone: '' }), [identityLoaded, setIdentityLoaded] = useState(false), [identityDirty, setIdentityDirty] = useState(false), [reason, setReason] = useState('');
  useEffect(() => { void route<{ cpf: string; phone: string }>(`/users/${user.authUserId}/identity`).then(v => { setIdentity(v); setIdentityLoaded(true); }, e => setError(errorText(e))); }, [user.authUserId]);
  useEffect(() => { void scholars.list(user.projectId!).then(setMembers, (e) => setError(errorText(e))); }, [user.projectId]);
  const member = members?.find((m) => m.id === scholarId);
  const mismatch = !!member?.email && member.email.trim().toLowerCase() !== user.email.toLowerCase();
  const linkable = role === 'scholar' || role === 'signer';
  // The member record (Bolsistas) may already hold the CPF and WhatsApp: offer them for the empty fields.
  const digitsOf = (v?: string) => (v ?? '').replace(/\D/g, '');
  const recordCpf = !mismatch && digitsOf(member?.cpf).length === 11 && !digitsOf(identity.cpf) ? digitsOf(member?.cpf) : '';
  const recordPhone = !mismatch && digitsOf(member?.phone).length >= 12 && digitsOf(identity.phone).length < 12 ? digitsOf(member?.phone) : '';
  const fromRecord = identityLoaded && (recordCpf || recordPhone) ? { cpf: recordCpf, phone: recordPhone } : null;
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (identityDirty) await route(`/users/${user.authUserId}/identity`, { method: 'PUT', body: JSON.stringify({ ...identity, reason }) });
      const r = await users.setAccess(user.authUserId, { projectId: user.projectId!, modules, scholarId: linkable ? scholarId || null : null });
      await onSaved(r.reboundSignatures ? `Acesso atualizado. ${r.reboundSignatures} assinatura(s) pendente(s) voltaram para a conta do próprio membro.` : 'Acesso atualizado.');
    } catch (x) { setError(errorText(x)); } finally { setBusy(false); }
  }
  return <Drawer open title="Editar acesso" description={`${user.name} · ${user.email}`} onClose={() => !busy && onClose()}>
    <form className="stack" onSubmit={save}>
      <dl className="facts"><div><dt>Perfil</dt><dd>{roleLabel[role]}</dd></div><div><dt>Projeto</dt><dd>{user.projectTitle}</dd></div></dl>
      <section className="access-block stack">
        <h4>Identidade para assinatura</h4>
        <p className="muted">Confira o CPF com a pessoa antes de confirmar. Ele fica vinculado exclusivamente a este login. Sem este cadastro, a conta não pode assinar.</p>
        <label className="field">CPF confirmado<input inputMode="numeric" value={identity.cpf} disabled={!identityLoaded || busy} maxLength={20} onChange={e => { setIdentity({ ...identity, cpf: e.target.value }); setIdentityDirty(true); }} /></label>
        <label className="field">WhatsApp da pessoa (DDI + DDD)<input type="tel" value={identity.phone} disabled={!identityLoaded || busy} maxLength={35} placeholder="5563999999999" onChange={e => { setIdentity({ ...identity, phone: e.target.value }); setIdentityDirty(true); }} /></label>
        {fromRecord && <div className="notice-inline" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <small className="muted">O cadastro do bolsista tem {[fromRecord.cpf && 'CPF', fromRecord.phone && 'WhatsApp'].filter(Boolean).join(' e ')} que ainda não {fromRecord.cpf && fromRecord.phone ? 'estão' : 'está'} aqui.</small>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { setIdentity({ cpf: fromRecord.cpf || identity.cpf, phone: fromRecord.phone || identity.phone }); setIdentityDirty(true); }}>Usar dados do cadastro</button>
        </div>}
        {identityDirty && <label className="field">Motivo e conferência do cadastro<input required minLength={5} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex.: dados conferidos diretamente com o titular" /></label>}
      </section>
      <section className="access-block">
        <h4>Incluído pelo perfil</h4>
        <div className="module-chips">{own.map((m) => <span key={m} className="module-chip">{MODULES[m].label}</span>)}</div>
      </section>
      <section className="access-block">
        <h4>Módulos adicionais</h4>
        <p className="muted">Habilite módulos além do perfil, somente neste projeto.</p>
        <ul className="module-toggles">{GRANTABLE.map((m) => {
          const byProfile = own.includes(m), on = byProfile || modules.includes(m);
          return <li key={m}><label className="module-toggle">
            <input type="checkbox" checked={on} disabled={byProfile || busy} onChange={(e) => setModules(e.target.checked ? [...new Set([...modules, m, ...(MODULES[m].requires ?? [])])] : modules.filter((x) => x !== m && !(MODULES[x as ModuleKey]?.requires ?? []).includes(m)))} />
            <span><b>{MODULES[m].label}</b><small>{byProfile ? 'Já incluído pelo perfil.' : MODULES[m].description}{!byProfile && MODULES[m].requires?.length ? ` Inclui: ${MODULES[m].requires!.map((r) => MODULES[r].label).join(' e ')}.` : ''}</small></span>
          </label></li>;
        })}</ul>
      </section>
      {linkable && <section className="access-block">
        <h4>Membro representado por esta conta</h4>
        {!members ? <Skeleton /> : <label className="field">Membro da equipe
          <select value={scholarId} onChange={(e) => setScholarId(e.target.value)} disabled={busy}>
            <option value="">Nenhum</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.email ? ` — ${m.email}` : ''}</option>)}
          </select>
          <small>O nome e a função do membro aparecem nas assinaturas feitas por esta conta. O e-mail do cadastro precisa ser o mesmo da conta.</small>
        </label>}
        {mismatch && <Notice tone="crit" title="E-mails diferentes">O cadastro de {member!.full_name} usa {member!.email}, mas a conta é {user.email}. Esta conta não pode representar esse membro: escolha o membro correto ou “Nenhum”.</Notice>}
      </section>}
      {error && <Notice tone="crit">{error}</Notice>}
      <div className="form-foot"><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-primary" disabled={busy || mismatch}>{busy ? 'Salvando…' : 'Salvar acesso'}</button></div>
    </form>
  </Drawer>;
}
