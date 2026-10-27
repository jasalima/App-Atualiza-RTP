import { beforeEach, describe, expect, it, vi } from 'vitest';
const { session, query } = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn() }));
vi.mock('../lib/authorize', () => ({
  requireUser: session,
  routeError: (error: { status?: number; message?: string }) => Response.json({ error: error.message }, { status: error.status || 500 })
}));
vi.mock('../lib/db', () => ({ sql: query }));
import { GET } from '../app/api/projects/route';

beforeEach(() => { session.mockReset(); query.mockReset(); });
describe('authenticated project bootstrap', () => {
  it('uses the session identity to scope projects and disables response caching', async () => {
    session.mockResolvedValue({ user: { id: 'authenticated-user' }, mustChangePassword: false });
    query.mockResolvedValue([{ id: 'project-a' }]);
    const response = await GET();
    expect(await response.json()).toEqual([{ id: 'project-a' }]);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    const [strings, ...values] = query.mock.calls[0];
    expect(values).toEqual(['authenticated-user']);
    const statement = strings.join('?');
    expect(statement).toContain('a.project_id=p.id');
    expect(statement).toContain("a.role='admin'");
    expect(statement).toContain('p.deleted_at IS NULL');
  });
  it('returns authentication failures as errors, without querying projects', async () => {
    session.mockRejectedValue({ status: 401, message: 'Autenticação necessária' });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
  it('does not expose project data before a required password change', async () => {
    session.mockResolvedValue({ user: { id: 'u' }, mustChangePassword: true });
    expect((await GET()).status).toBe(428);
    expect(query).not.toHaveBeenCalled();
  });
  it('reports database failure instead of a successful empty project list', async () => {
    session.mockResolvedValue({ user: { id: 'u' }, mustChangePassword: false });
    query.mockRejectedValue(new Error('Conexão indisponível'));
    expect((await GET()).status).toBe(500);
  });
});
