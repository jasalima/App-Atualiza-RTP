import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), own: vi.fn(), provision: vi.fn(), batch: vi.fn(), state: vi.fn(), connect: vi.fn() }));
vi.mock('../lib/authorize', () => ({ requireProject: mocks.access }));
vi.mock('../lib/travel', () => ({ sameOrigin: () => {}, travelError: (error: { status?: number; message?: string }) => Response.json({ error: error.message }, { status: error.status || 500 }) }));
vi.mock('../lib/whatsapp-connections', () => ({ ownWhatsApp: mocks.own, provisionWhatsApp: mocks.provision, provisionProjectWhatsApp: mocks.batch }));
vi.mock('../server/services/evolution', () => ({ Evolution: class { state = mocks.state; connect = mocks.connect; } }));
import { GET, POST } from '../app/api/travel/connection/route';
const projectId = '10ab6e37-f57e-41e0-8218-6f69d51c33c4';
const request = (action: string) => new Request('https://app.example/api/travel/connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, action, userId: 'foreign-user', instance: 'foreign-app' }) });
beforeEach(() => { Object.values(mocks).forEach(fn => fn.mockReset()); mocks.access.mockResolvedValue({ user: { id: 'current-user' } }); });
describe('WhatsApp connection authorization', () => {
  it('provisions only the authenticated user, ignoring forged user/instance fields', async () => {
    mocks.provision.mockResolvedValue({ instance: 'Gesproject-own', created: true });
    expect((await POST(request('provision'))).status).toBe(200);
    expect(mocks.provision).toHaveBeenCalledWith(projectId, 'current-user');
    expect(mocks.access).toHaveBeenCalledWith(projectId, false);
  });
  it('requires management permission for project-wide provisioning', async () => {
    mocks.access.mockRejectedValue({ status: 403, message: 'Acesso negado' });
    expect((await POST(request('provisionProject'))).status).toBe(403);
    expect(mocks.access).toHaveBeenCalledWith(projectId, true);
    expect(mocks.batch).not.toHaveBeenCalled();
  });
  it('pairs only the current user connection and never returns its key', async () => {
    mocks.own.mockResolvedValue({ instance: 'Gesproject-own', token: 'private-key' });
    mocks.state.mockResolvedValue('close'); mocks.connect.mockResolvedValue({ connected: false, qr: 'qr-data' });
    const response = await POST(request('connect'));
    expect(mocks.own).toHaveBeenCalledWith(projectId, 'current-user');
    expect(mocks.connect).toHaveBeenCalledWith('Gesproject-own', 'private-key');
    expect(await response.json()).toEqual({ connected: false, qr: 'qr-data' });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
  it('reports paired state without exposing credentials', async () => {
    mocks.own.mockResolvedValue({ instance: 'Gesproject-own', token: 'private-key' }); mocks.state.mockResolvedValue('open');
    const response = await GET(new Request(`https://app.example/api/travel/connection?projectId=${projectId}`));
    const body = await response.json();
    expect(body.configured).toBe(true);
    expect(JSON.stringify(body)).not.toContain('private-key');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
  it('keeps document downloads available when the provider is offline', async () => {
    mocks.own.mockResolvedValue({ instance: 'Gesproject-own', token: 'private-key' }); mocks.state.mockRejectedValue(new Error('offline'));
    const response = await GET(new Request(`https://app.example/api/travel/connection?projectId=${projectId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ configured: false, state: 'unavailable' });
  });
});
