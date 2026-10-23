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

export function resetDataApiToken() { cached = null; }

async function getToken(): Promise<string | null> {
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  const response = await fetch('/api/auth/token', { credentials: 'include' });
  if (!response.ok) { cached = null; return null; }
  const { token } = await response.json() as { token?: string };
  if (!token) { cached = null; return null; }
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    cached = { token, expiresAt: Number(payload.exp) * 1000 };
  } catch { cached = { token, expiresAt: Date.now() + 5 * 60_000 }; }
  return token;
}

const data = createClient({ dataApi: { url: process.env.NEXT_PUBLIC_NEON_DATA_API_URL!, getToken } });

export const neon = Object.assign(data, { auth });
