import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, sql: vi.fn(), ensure: vi.fn(), del: vi.fn() }));
vi.mock('../lib/db', () => ({ sql: (strings: TemplateStringsArray, ...values: unknown[]) => { m.sql(strings.join('?'), values); return Promise.resolve(strings.join('?').startsWith('SELECT') ? m.rows : []); } }));
vi.mock('../lib/connectivity-config', () => ({ evolutionForProject: async () => ({ ensure: m.ensure, deleteInstance: m.del }), ConnectivityError: class extends Error {} }));
import { gesprojectInstance } from '../server/services/evolution';
import { sealCredential } from '../server/services/travel-credentials';
import { ownsInstance, ownWhatsApp, replaceWhatsApp } from '../lib/whatsapp-connections';
const base = gesprojectInstance('p', 'u');
beforeEach(() => { vi.stubEnv('WHATSAPP_CREDENTIAL_SECRET', 'test-secret-longer-than-32-characters'); m.rows = []; m.sql.mockReset(); m.ensure.mockReset().mockResolvedValue({ created: true }); m.del.mockReset().mockRejectedValue(new Error('Connection Closed')); });
describe('Replacing a stuck WhatsApp connection', () => {
  it('accepts only this account\'s original or replacement names', () => {
    expect(ownsInstance('p', 'u', base)).toBe(true);
    expect(ownsInstance('p', 'u', `${base}-ra1b2c3`)).toBe(true);
    expect(ownsInstance('p', 'u', `${gesprojectInstance('p', 'other')}-ra1b2c3`)).toBe(false);
    expect(ownsInstance('p', 'u', `${base}-rzzzzzz`)).toBe(false);
    expect(ownsInstance('p', 'u', 'foreign-app')).toBe(false);
  });
  it('creates a fresh instance even when the stuck one cannot be deleted', async () => {
    m.rows = [{ instance: base, api_key: sealCredential('old', 'u:p') }];
    const fresh = await replaceWhatsApp('p', 'u');
    expect(fresh.instance).toMatch(new RegExp(`^${base}-r[0-9a-f]{6}$`));
    expect(fresh.previous).toBe(base);
    expect(m.del).toHaveBeenCalledWith(base);
    expect(m.ensure).toHaveBeenCalledWith(fresh.instance, fresh.token);
    expect(fresh.token).not.toBe('old');
  });
  it('the replacement is recognised as the account connection', async () => {
    m.rows = [{ instance: `${base}-ra1b2c3`, api_key: sealCredential('new', 'u:p') }];
    expect(await ownWhatsApp('p', 'u')).toEqual({ instance: `${base}-ra1b2c3`, token: 'new' });
  });
});
