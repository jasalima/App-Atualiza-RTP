import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), user: vi.fn() }));
vi.mock('../lib/db', () => ({ sql: mocks.query }));
vi.mock('../lib/authorize', () => ({ requireUser: mocks.user, routeError: (e: { message?: string; status?: number }) => Response.json({ error: e.message }, { status: e.status || 500 }) }));
import { GET } from '../app/api/changes/route';

const text = (c: unknown[]) => (c[0] as string[]).join('?');
const call = (since?: number) => GET(new Request(`https://app.example/api/changes${since === undefined ? '' : `?since=${since}`}`));
beforeEach(() => {
  mocks.query.mockReset(); mocks.user.mockReset();
  mocks.user.mockResolvedValue({ user: { id: 'u1' }, mustChangePassword: false });
});

describe('telas ao vivo', () => {
  it('a primeira chamada devolve o ponto de partida', async () => {
    mocks.query.mockResolvedValueOnce([{ role: 'scholar', project_id: 'p1' }]).mockResolvedValueOnce([{ last: '42' }]);
    expect(await (await call()).json()).toEqual({ last: 42, events: [] });
  });
  it('entrega na hora o RTP salvo por outro usuário, só dos projetos da pessoa', async () => {
    mocks.query.mockResolvedValueOnce([{ role: 'coordinator', project_id: 'p1' }])
      .mockResolvedValueOnce([{ id: '43', project_id: 'p1', entity: 'reports', entity_id: 'r9', action: 'insert' }]);
    const body = await (await call(42)).json();
    expect(body).toEqual({ last: 43, events: [{ projectId: 'p1', entity: 'reports', id: 'r9', action: 'insert' }] });
    const feed = mocks.query.mock.calls[1];
    expect(text(feed)).toMatch(/project_id=ANY\(\?::uuid\[\]\)/);
    expect(feed).toContainEqual(['p1']);
  });
  it('sem a tabela do feed (migração pendente), responde sem quebrar a tela', async () => {
    mocks.query.mockResolvedValueOnce([{ role: 'admin', project_id: null }]).mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    expect(await (await call(1)).json()).toEqual({ last: null, events: [], unavailable: true });
  });
  it('conta só de assinatura acompanha apenas assinaturas', async () => {
    mocks.query.mockResolvedValueOnce([{ role: 'signer', project_id: 'p1' }]).mockResolvedValueOnce([{ id: '5', project_id: 'p1', entity: 'signature_requests', entity_id: 'q', action: 'update' }]);
    await call(4);
    expect(mocks.query.mock.calls[1]).toContain(true); // signerOnly flag sent to the query
    expect(text(mocks.query.mock.calls[1])).toMatch(/entity='signature_requests'/);
  });
});
