import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), query: vi.fn() }));
vi.mock('../lib/authorize', () => ({ requireProject: mocks.access }));
vi.mock('../lib/db', () => ({ sql: mocks.query }));
vi.mock('../lib/travel', () => ({ travelError: (error: { status?: number; message?: string }) => Response.json({ error: error.message }, { status: error.status || 500 }) }));
import { GET } from '../app/api/documents/deliveries/route';
const projectId = '10ab6e37-f57e-41e0-8218-6f69d51c33c4';
const call = () => GET(new Request(`https://app.example/api/documents/deliveries?projectId=${projectId}`));
beforeEach(() => { mocks.access.mockReset(); mocks.query.mockReset(); });
describe('document send status', () => {
  it('summarizes the sends of the whole project for managers', async () => {
    mocks.access.mockResolvedValue({ role: 'coordinator', user: { id: 'manager' } });
    mocks.query.mockResolvedValue([{ source_kind: 'rtp', source_id: 'r1', sent_at: '2026-10-27T18:47:49.141Z', sent_version: 8, sent_count: 1, uncertain: false, sending: false }]);
    const response = await call();
    expect(await response.json()).toEqual([{ kind: 'rtp', id: 'r1', sentAt: '2026-10-27T18:47:49.141Z', sentVersion: 8, sentCount: 1, uncertain: false, sending: false }]);
    const [strings, ...values] = mocks.query.mock.calls[0];
    expect(strings.join('?')).toContain('project_id=');
    expect(values).toEqual([projectId, false, 'manager']);
  });
  it('limits a member to their own sends', async () => {
    mocks.access.mockResolvedValue({ role: 'scholar', scholarId: 's1', user: { id: 'member' } });
    mocks.query.mockResolvedValue([]);
    await call();
    expect(mocks.query.mock.calls[0].slice(1)).toEqual([projectId, true, 'member']);
  });
  it('requires access to the project', async () => {
    mocks.access.mockRejectedValue({ status: 403, message: 'Acesso negado.' });
    expect((await call()).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
