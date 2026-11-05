import { useEffect, useState, type FormEvent } from 'react';
import { route } from './api';
import { Drawer, Notice, errorText } from './ui';

export default function IdentityDrawer({ userId, name, onClose, onSaved }: { userId: string; name: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ cpf: '', phone: '', reason: '' }), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState('');
  useEffect(() => { void route<{ cpf: string; phone: string }>(`/users/${userId}/identity`).then(data => { setForm({ ...data, reason: '' }); setReady(true); }, e => setError(errorText(e))); }, [userId]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await route(`/users/${userId}/identity`, { method: 'PUT', body: JSON.stringify(form) }); onSaved(); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <Drawer open title="Confirmar identidade para assinatura" description={name} onClose={() => !busy && onClose()}>
    <form className="stack" onSubmit={save}>
      <p>Confira os dados diretamente com o titular. O CPF ficará vinculado a esta conta e não poderá ser usado por outro login.</p>
      <label className="field">CPF confirmado<input required inputMode="numeric" maxLength={20} value={form.cpf} disabled={!ready || busy} onChange={e => setForm({ ...form, cpf: e.target.value })} /></label>
      <label className="field">WhatsApp (DDI + DDD)<input type="tel" maxLength={35} value={form.phone} disabled={!ready || busy} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
      <label className="field">Motivo e conferência do cadastro<input required minLength={5} maxLength={500} value={form.reason} disabled={!ready || busy} onChange={e => setForm({ ...form, reason: e.target.value })} /></label>
      {error && <Notice tone="crit">{error}</Notice>}
      <button className="btn btn-primary" disabled={!ready || busy}>{busy ? 'Salvando…' : 'Confirmar CPF da conta'}</button>
    </form>
  </Drawer>;
}
