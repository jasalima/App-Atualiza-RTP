// A session reset invalidates pending requests as well as the cached token.
export function createTokenStore(fetcher: typeof fetch = fetch) {
  let generation = 0;
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;
  return {
    reset() { generation++; cached = null; pending = null; },
    get(): Promise<string> {
      if (cached && cached.expiresAt - 60_000 > Date.now()) return Promise.resolve(cached.token);
      if (pending) return pending;
      const current = generation;
      const request = (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) await new Promise(resolve => setTimeout(resolve, attempt * 400));
          if (current !== generation) throw new Error('Sessão alterada.');
          let response: Response | null = null;
          try { response = await fetcher('/api/auth/token', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000) }); } catch { /* transient network failure */ }
          if (current !== generation) throw new Error('Sessão alterada.');
          if (response?.status === 401 || response?.status === 403) break;
          const body = response?.ok ? await response.json().catch(() => null) : null;
          if (current !== generation) throw new Error('Sessão alterada.');
          if (typeof body?.token !== 'string' || !body.token) continue;
          let expiresAt = Date.now() + 5 * 60_000;
          try {
            const payload = JSON.parse(atob(body.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (Number.isFinite(payload.exp)) expiresAt = payload.exp * 1000;
          } catch { /* opaque tokens use a short cache */ }
          if (expiresAt <= Date.now()) continue;
          cached = { token: body.token, expiresAt };
          return body.token as string;
        }
        throw new Error('Não foi possível confirmar sua sessão. Tente novamente.');
      })();
      pending = request;
      void request.finally(() => { if (pending === request) pending = null; }).catch(() => {});
      return request;
    }
  };
}
