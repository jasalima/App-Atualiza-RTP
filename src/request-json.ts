// Retry reads only: repeating document generation or mutations can duplicate work.
export async function requestJson<T>(path: string, options: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const read = !options.method || options.method.toUpperCase() === 'GET';
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const attempts = read ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, attempt * 500));
    let response: Response;
    try {
      response = await fetcher(`/api${path}`, { ...options, headers, credentials: 'include', ...(read ? { cache: 'no-store', signal: options.signal ?? AbortSignal.timeout(20000) } : {}) });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (attempt + 1 < attempts) continue;
      throw new Error('Não foi possível conectar. Verifique sua conexão e tente novamente.');
    }
    if (read && [408, 429, 500, 502, 503, 504].includes(response.status) && attempt + 1 < attempts) continue;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || 'Não foi possível concluir a operação.');
    if (data === null) throw new Error('O servidor retornou uma resposta incompleta. Tente novamente.');
    return data as T;
  }
  throw new Error('Não foi possível concluir a operação.');
}
