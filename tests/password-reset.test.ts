import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ admin: vi.fn(), set: vi.fn(), revoke: vi.fn(), rows: vi.fn(), tx: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { admin: { setUserPassword: m.set, revokeUserSessions: m.revoke } } }));
vi.mock('@/lib/authorize', () => ({ requireAdmin: m.admin, routeError: (e: { status?: number; message?: string }) => Response.json({ error: e.message }, { status: e.status || 500 }) }));
vi.mock('@/lib/db', () => ({ sql: Object.assign((s: TemplateStringsArray, ...v: unknown[]) => m.rows(s.join('?'), v), { transaction: m.tx }) }));
vi.mock('@/lib/users', () => ({ temporaryPassword: () => 'Temp#Senha-12345' }));
import { POST } from '../app/api/users/[id]/password/route';

const call = (id: string) => POST(new Request('https://app.example/api/users/x/password', { method: 'POST' }), { params: Promise.resolve({ id }) });
beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.admin.mockResolvedValue({ id: 'admin-1' });
  m.rows.mockImplementation((q: string) => Promise.resolve(q.includes('FROM managed_users') ? [{ auth_user_id: 'u-2', name: 'Gilson', email: 'g@uft.edu.br' }] : []));
  m.set.mockResolvedValue({ data: { status: true }, error: null });
  m.revoke.mockResolvedValue({ data: { success: true }, error: null });
  m.tx.mockResolvedValue([]);
});
describe('redefinição de senha pelo administrador', () => {
  it('gera senha temporária, encerra sessões, exige troca e registra auditoria', async () => {
    const res = await call('u-2');
    expect(await res.json()).toEqual({ email: 'g@uft.edu.br', temporaryPassword: 'Temp#Senha-12345', sessionsRevoked: true });
    expect(m.set).toHaveBeenCalledWith({ userId: 'u-2', newPassword: 'Temp#Senha-12345' });
    expect(m.revoke).toHaveBeenCalledWith({ userId: 'u-2' });
    expect(m.tx).toHaveBeenCalledTimes(1);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it('não redefine a própria senha nem a de outro administrador', async () => {
    expect((await call('admin-1')).status).toBe(400);
    m.rows.mockImplementation((q: string) => Promise.resolve(q.includes('FROM managed_users') ? [{ auth_user_id: 'u-3' }] : [{ '?column?': 1 }]));
    expect((await call('u-3')).status).toBe(403);
    expect(m.set).not.toHaveBeenCalled();
  });
  it('somente administradores', async () => {
    m.admin.mockRejectedValue(Object.assign(new Error('Acesso restrito à administração.'), { status: 403 }));
    expect((await call('u-2')).status).toBe(403);
    expect(m.set).not.toHaveBeenCalled();
  });
  it('explica quando o Neon Auth recusa por falta do papel de administrador', async () => {
    m.set.mockResolvedValue({ data: null, error: { status: 403, message: 'forbidden' } });
    const res = await call('u-2');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('administrador no Neon Auth');
    expect(m.tx).not.toHaveBeenCalled();
  });
});
