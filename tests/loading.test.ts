import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTokenStore } from '../src/data-token';
import { requestJson } from '../src/request-json';

afterEach(() => vi.useRealTimers());
describe('session initialization', () => {
  it('shares one token request between simultaneous queries', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ token: 'authenticated' }));
    const store = createTokenStore(fetcher);
    expect(await Promise.all([store.get(), store.get(), store.get()])).toEqual(['authenticated', 'authenticated', 'authenticated']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await store.get();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects a token from the previous account, even if it arrives after the new token', async () => {
    let resolveOld!: (r: Response) => void;
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(Response.json({ token: 'new-account' }));
    const store = createTokenStore(fetcher);
    const old = store.get();
    const rejected = expect(old).rejects.toThrow('Sessão alterada');
    store.reset();
    expect(await store.get()).toBe('new-account');
    resolveOld(Response.json({ token: 'old-account' }));
    await rejected;
    expect(await store.get()).toBe('new-account');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('recovers from a temporary token failure without reloading', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(Response.json({ token: 'ready' }));
    const result = createTokenStore(fetcher).get();
    await vi.runAllTimersAsync();
    expect(await result).toBe('ready');
  });
  it('never treats an unauthenticated request as an empty data set', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
    await expect(createTokenStore(fetcher).get()).rejects.toThrow('confirmar sua sessão');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
describe('data reads', () => {
  it('retries temporary server failures and returns the actual projects', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(Response.json([{ id: 'existing-project' }]));
    const result = requestJson('/projects', {}, fetcher);
    await vi.runAllTimersAsync();
    expect(await result).toEqual([{ id: 'existing-project' }]);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'include' });
  });
  it('does not retry mutations or authorization denials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'Acesso negado' }, { status: 403 }));
    await expect(requestJson('/projects', {}, fetcher)).rejects.toThrow('Acesso negado');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear().mockResolvedValue(Response.json({ error: 'Indisponível' }, { status: 503 }));
    await expect(requestJson('/reports/generate', { method: 'POST' }, fetcher)).rejects.toThrow('Indisponível');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('preserves a legitimate empty result, but rejects invalid or failed responses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(new Response('not-json')).mockResolvedValueOnce(Response.json([], { status: 403 }));
    expect(await requestJson('/projects', {}, fetcher)).toEqual([]);
    await expect(requestJson('/projects', {}, fetcher)).rejects.toThrow('resposta incompleta');
    await expect(requestJson('/projects', {}, fetcher)).rejects.toThrow('concluir a operação');
  });
});
