import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../lib/db', () => ({ sql: mocks.query }));
vi.mock('../lib/authorize', () => ({ requireUser: vi.fn() }));
vi.mock('../lib/storage', () => ({ readPrivateObject: vi.fn(), putPrivateObject: vi.fn() }));
import { reclaimSignerSlots } from '../lib/signatures';

const text = (c: unknown[]) => (c[0] as string[]).join('?');
beforeEach(() => mocks.query.mockReset());

describe('vaga de assinatura vinculada à conta errada', () => {
  it('volta para a conta do próprio membro (mesmo e-mail) e fica registrada na auditoria', async () => {
    mocks.query.mockResolvedValueOnce([{ request_id: 'req', previous: 'joyce', project_id: 'p1' }]).mockResolvedValue([]);
    expect(await reclaimSignerSlots({ id: 'jaasiel', email: 'Jasafone@Gmail.com' })).toBe(1);
    const [update, audit] = mocks.query.mock.calls;
    expect(text(update)).toMatch(/lower\(m\.email\)=\?/);                         // the member's own e-mail
    expect(text(update)).toMatch(/NOT EXISTS\(SELECT 1 FROM neon_auth\."user" b/); // only when the bound account has another e-mail
    expect(text(update)).toMatch(/s\.status='pending'/);                          // never touches a given signature
    expect(update).toContain('jasafone@gmail.com');
    expect(text(audit)).toMatch(/reclaim_signature_slot/);
  });
  it('sem e-mail na sessão não faz nada', async () => {
    expect(await reclaimSignerSlots({ id: 'x', email: '' })).toBe(0);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
