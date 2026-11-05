import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), calls: [] as Array<{ text: string; values: unknown[] }>, transaction: vi.fn() }));
const content = { heading: { project: 'Projeto de exemplo', scholar: 'Membro' }, sections: { results: 'Original', comparison: 'Original', additional: '' }, closing: { scholar: 'Membro' } };
vi.mock('../lib/signatures', () => ({ requestAccess: mocks.access }));
vi.mock('../lib/auth', () => ({ auth: { getSession: vi.fn() } }));
vi.mock('../lib/db', () => ({ sql: Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('?'); mocks.calls.push({ text, values });
  return Promise.resolve(/SELECT r.current_version/.test(text) ? [{ current_version: 1, content }] : []);
}, { transaction: mocks.transaction }) }));
import { PUT } from '../app/api/signatures/[id]/document/route';
const id = '10000000-0000-4000-8000-000000000001';
const sections = { results: 'Revisado pelo próprio membro', comparison: 'Resultados conferidos', additional: 'Informações atualizadas' };
const save = () => PUT(new Request('https://app.example/api/signatures/id/document', { method: 'PUT', headers: { origin: 'https://app.example' }, body: JSON.stringify({ sections }) }), { params: Promise.resolve({ id }) });
beforeEach(() => {
  mocks.calls.length = 0; mocks.transaction.mockReset();
  mocks.access.mockResolvedValue({ user: { id: 'own-account' }, canEdit: true, anySigned: false, request: { project_id: id, source_id: id, source_kind: 'rtp' } });
  mocks.transaction.mockResolvedValue([[], [{ version: 2 }], [], []]);
});
describe('RTP recebido para assinatura', () => {
  it('salva as seções revisadas pelo membro em nova versão e mantém a identificação do documento', async () => {
    const response = await save(), result = await response.json();
    expect(response.status).toBe(200); expect(result.version).toBe(2);
    expect(result.content.sections).toEqual(sections); expect(result.content.heading).toEqual(content.heading);
    expect(mocks.calls.some(c => /approved_by=NULL/.test(c.text))).toBe(true);
    expect(mocks.calls.some(c => /audit_logs/.test(c.text) && c.values.includes('own-account'))).toBe(true);
  });
  it('não edita depois da primeira assinatura', async () => {
    mocks.access.mockResolvedValue({ canEdit: false, anySigned: true, request: {} });
    expect((await save()).status).toBe(409); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('recusa gravação se a solicitação mudar enquanto a pessoa edita', async () => {
    mocks.transaction.mockResolvedValue([[], [], [], []]);
    expect((await save()).status).toBe(409);
  });
});
