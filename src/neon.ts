'use client';

import { createClient } from '@neondatabase/neon-js';
import { createAuthClient } from '@neondatabase/neon-js/auth/next';

// Auth goes through this app's /api/auth handler (app/api/auth/[...path]), so the
// session cookie lives on the app's domain and Route Handlers see the same session.
const auth = createAuthClient();

// The Data API needs a Neon Auth JWT. The handler's cached get-session response
// carries only the opaque session token, so the JWT is fetched from /api/auth/token
// and reused until shortly before it expires.
let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

export function resetDataApiToken() { cached = null; inflight = null; }

async function fetchToken(): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch('/api/auth/token', { credentials: 'include' }).catch(() => null);
    if (response?.status === 401) break;
    const token = response?.ok ? ((await response.json()) as { token?: string }).token : undefined;
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        cached = { token, expiresAt: Number(payload.exp) * 1000 };
      } catch { cached = { token, expiresAt: Date.now() + 5 * 60_000 }; }
      return token;
    }
  }
  cached = null;
  // Never fall back to an anonymous request: RLS would answer with empty lists
  // and the screen would silently show no data.
  throw new Error('Sua sessão não pôde ser confirmada. Recarregue a página ou entre novamente.');
}

// Parallel queries share one token request instead of racing for it.
async function getToken(): Promise<string | null> {
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  inflight ??= fetchToken().finally(() => { inflight = null; });
  return inflight;
}

const data = createClient({ dataApi: { url: process.env.NEXT_PUBLIC_NEON_DATA_API_URL!, getToken } });

export const neon = Object.assign(data, { auth });
