import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../lib/db', () => ({ sql: mocks.query }));
vi.mock('../lib/authorize', () => ({ requireUser: vi.fn() }));
vi.mock('../lib/storage', () => ({ readPrivateObject: vi.fn(), putPrivateObject: vi.fn() }));
import { releaseForDeletion } from '../lib/signatures';

const base = { manager: true, userId: 'u1', projectId: 'p1' };
const text = (c: unknown[]) => (c[0] as string[]).join('?');
beforeEach(() => mocks.query.mockReset());

describe('excluir documento com assinaturas', () => {
  it('sem pedido explícito, recusa com o código SIGNED (a tela oferece cancelar e excluir)', async () => {
    mocks.query.mockResolvedValueOnce([{ status: 'pending' }]);
    await expect(releaseForDeletion('travel', 'r1', base)).rejects.toMatchObject({ status: 409, code: 'SIGNED' });
  });
  it('só a coordenação cancela, e com motivo', async () => {
    mocks.query.mockResolvedValue([{ status: 'completed' }]);
    await expect(releaseForDeletion('travel', 'r1', { ...base, manager: false, cancelSignatures: true, reason: 'Relatório de teste' })).rejects.toMatchObject({ status: 403 });
    await expect(releaseForDeletion('travel', 'r1', { ...base, cancelSignatures: true, reason: 'x' })).rejects.toMatchObject({ status: 400 });
  });
  it('com motivo, cancela as solicitações e registra na auditoria', async () => {
    mocks.query.mockResolvedValueOnce([{ status: 'pending' }]).mockResolvedValueOnce([{ id: 'req1' }]).mockResolvedValue([]);
    expect(await releaseForDeletion('travel', 'r1', { ...base, cancelSignatures: true, reason: 'Relatório de teste' })).toBe(1);
    expect(text(mocks.query.mock.calls[1])).toMatch(/UPDATE signature_requests SET status='cancelled'/);
    expect(mocks.query.mock.calls[1]).toContain('Documento excluído: Relatório de teste');
    expect(text(mocks.query.mock.calls[2])).toMatch(/cancel_signatures/);
  });
  it('sem assinaturas registradas, apenas encerra solicitações abertas, sem exigir nada', async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'req1' }]);
    expect(await releaseForDeletion('rtp', 'r2', base)).toBe(1);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
});
