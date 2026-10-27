import { afterEach, describe, expect, it, vi } from 'vitest';
import { Evolution, gesprojectInstance } from '../server/services/evolution';
import { sealCredential } from '../server/services/travel-credentials';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../lib/db', () => ({ sql: query }));
vi.mock('../lib/connectivity-config', async () => {
  const { Evolution } = await import('../server/services/evolution');
  return { evolutionForProject: async () => new Evolution(), ConnectivityError: class extends Error { code: string; constructor(message: string, code: string) { super(message); this.code = code; } } };
});
import { ownWhatsApp, provisionWhatsApp } from '../lib/whatsapp-connections';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); query.mockReset(); });
describe('Gesproject instances', () => {
  it('assigns a stable, distinct name to each user and project without exposing user identifiers', () => {
    const name = gesprojectInstance('aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb', 'user-private-id');
    expect(name).toMatch(/^Gesproject-[a-z0-9-]+$/);
    expect(name.length).toBeLessThan(100);
    expect(name).not.toContain('user-private-id');
    expect(gesprojectInstance('p1', 'u1')).toBe(gesprojectInstance('p1', 'u1'));
    expect(gesprojectInstance('p1', 'u1')).not.toBe(gesprojectInstance('p1', 'u2'));
    expect(gesprojectInstance('p1', 'u1')).not.toBe(gesprojectInstance('p2', 'u1'));
  });
  it('creates only the scoped name, with a separate token and integrations disabled', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([{ name: 'other-app' }])).mockResolvedValueOnce(Response.json({ instance: { instanceName: 'Gesproject-new' } }));
    expect(await new Evolution('https://evolution.example', 'master', fetcher).ensure('Gesproject-new', 'individual-key')).toEqual({ created: true });
    const [, options] = fetcher.mock.calls[1];
    const body = JSON.parse(String(options!.body));
    expect(body).toMatchObject({ instanceName: 'Gesproject-new', token: 'individual-key', qrcode: false, integration: 'WHATSAPP-BAILEYS', syncFullHistory: false });
    for (const integration of ['webhook', 'rabbitmq', 'websocket', 'sqs', 'chatwoot']) expect(body).not.toHaveProperty(integration);
    expect(fetcher.mock.calls.every(([, init]) => init!.method !== 'DELETE')).toBe(true);
  });
  it('reuses its own existing instance without rotating credentials or creating another one', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([{ name: 'Gesproject-own', token: 'own-key' }])).mockResolvedValueOnce(Response.json({ instance: { state: 'close' } }));
    expect(await new Evolution('https://evolution.example', 'master', fetcher).ensure('Gesproject-own', 'own-key')).toEqual({ created: false });
    expect(fetcher.mock.calls.every(([, init]) => init!.method === 'GET')).toBe(true);
    expect((fetcher.mock.calls[1][1]!.headers as Record<string, string>).apikey).toBe('own-key');
  });
  it('treats a missing scoped instance (HTTP 404) as eligible for creation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: 'not found' }, { status: 404 })).mockResolvedValueOnce(Response.json({ instance: { instanceName: 'Gesproject-new' } }));
    expect(await new Evolution('https://evolution.example', 'master', fetcher).ensure('Gesproject-new', 'key')).toEqual({ created: true });
    expect(fetcher.mock.calls[1][1]!.method).toBe('POST');
  });
  it('refuses to adopt a preexisting instance with another key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([{ name: 'Gesproject-collision', token: 'foreign-key' }]));
    await expect(new Evolution('https://evolution.example', 'master', fetcher).ensure('Gesproject-collision', 'my-key')).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('recovers an uncertain creation only by authenticating with its own persisted token', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([])).mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(Response.json({ instance: { state: 'close' } }));
    expect(await new Evolution('https://evolution.example', 'master', fetcher).ensure('Gesproject-own', 'key')).toEqual({ created: false });
    expect(fetcher.mock.calls.filter(([, init]) => init!.method === 'POST')).toHaveLength(1);
  });
  it('returns only QR data, never provider credentials, to the browser', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ base64: 'data:image/png;base64,YWJj', token: 'secret', hash: 'secret', code: 'sensitive' }));
    expect(await new Evolution('https://evolution.example', 'master', fetcher).connect('Gesproject-own', 'key')).toEqual({ qr: 'data:image/png;base64,YWJj', connected: false });
  });
  it('rejects insecure URLs before transmitting credentials', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new Evolution('http://evolution.example', 'master', fetcher).state('own', 'key')).rejects.toThrow('HTTPS');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('stored instance isolation', () => {
  it('uses the persisted winner key when retrying provisioning instead of rotating it', async () => {
    vi.stubEnv('WHATSAPP_CREDENTIAL_SECRET', 'test-secret-longer-than-32-characters');
    const name = gesprojectInstance('p', 'u');
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ instance: name, api_key: sealCredential('persisted-winner', 'u:p') }]);
    const ensure = vi.spyOn(Evolution.prototype, 'ensure').mockResolvedValue({ created: false });
    expect(await provisionWhatsApp('p', 'u')).toEqual({ instance: name, created: false });
    expect(ensure).toHaveBeenCalledWith(name, 'persisted-winner');
    expect(query.mock.calls[0][0].join('?')).toContain('WHERE project_whatsapp_connections.instance<>EXCLUDED.instance');
  });
  it('refuses legacy connections from another application', async () => {
    query.mockResolvedValueOnce([{ instance: 'other-app', api_key: 'not-decrypted' }]);
    expect(await ownWhatsApp('project', 'user')).toBeNull();
  });
  it('decrypts only the connection reserved for this user/project pair', async () => {
    vi.stubEnv('WHATSAPP_CREDENTIAL_SECRET', 'test-secret-longer-than-32-characters');
    query.mockResolvedValueOnce([{ instance: gesprojectInstance('p', 'u'), api_key: sealCredential('own-key', 'u:p') }]);
    expect(await ownWhatsApp('p', 'u')).toEqual({ instance: gesprojectInstance('p', 'u'), token: 'own-key' });
    expect(query.mock.calls[0].slice(1)).toEqual(['p', 'u']);
  });
});
