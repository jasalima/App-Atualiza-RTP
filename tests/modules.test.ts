import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), user: vi.fn() }));
vi.mock('../lib/db', () => ({ sql: mocks.query }));
vi.mock('../lib/authorize', () => ({ requireUser: mocks.user }));
import { requireModule } from '../lib/modules';
import { GRANTABLE, PROFILE_MODULES } from '../lib/modules-catalog';

const text = (call: unknown[]) => (call[0] as string[]).join('?');
beforeEach(() => { mocks.query.mockReset(); mocks.user.mockReset(); mocks.user.mockResolvedValue({ user: { id: 'u1' }, mustChangePassword: false }); });

describe('módulos por conta', () => {
  it('coordenação usa Atas de Reunião pelo perfil, sem habilitação', async () => {
    mocks.query.mockResolvedValueOnce([{ role: 'coordinator', scholar_id: null }]);
    await expect(requireModule('p1', 'minutes')).resolves.toMatchObject({ role: 'coordinator' });
    expect(mocks.query.mock.calls.some((c) => /user_modules/.test(text(c)))).toBe(false);
  });
  it('conta somente assinatura entra em Atas quando o módulo foi habilitado no projeto', async () => {
    mocks.query.mockResolvedValueOnce([{ role: 'signer', scholar_id: 's1' }]).mockResolvedValueOnce([{ '?column?': 1 }]);
    await expect(requireModule('p1', 'minutes')).resolves.toMatchObject({ role: 'signer', scholarId: 's1' });
  });
  it('sem habilitação, a conta recebe 403 com o nome do módulo', async () => {
    mocks.query.mockResolvedValueOnce([{ role: 'scholar', scholar_id: 's1' }]).mockResolvedValueOnce([]);
    await expect(requireModule('p1', 'minutes')).rejects.toMatchObject({ status: 403, message: expect.stringContaining('Atas de Reunião') });
  });
  it('sem acesso ao projeto ou com senha temporária, nada passa', async () => {
    mocks.query.mockResolvedValueOnce([]);
    await expect(requireModule('p1', 'minutes')).rejects.toMatchObject({ status: 403 });
    mocks.user.mockResolvedValueOnce({ user: { id: 'u1' }, mustChangePassword: true });
    await expect(requireModule('p1', 'minutes')).rejects.toMatchObject({ status: 428 });
  });
  it('catálogo: atas é habilitável e assinatura é o único módulo do perfil somente assinatura', () => {
    expect(GRANTABLE).toContain('minutes');
    expect(PROFILE_MODULES.signer).toEqual(['signatures']);
    expect(PROFILE_MODULES.scholar).not.toContain('minutes');
  });
});
