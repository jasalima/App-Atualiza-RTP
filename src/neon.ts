'use client';

import { createClient } from '@neondatabase/neon-js';
import { createAuthClient } from '@neondatabase/neon-js/auth/next';
import { createTokenStore } from './data-token';

// Auth goes through this app's /api/auth handler (app/api/auth/[...path]), so the
// session cookie lives on the app's domain and Route Handlers see the same session.
const auth = createAuthClient();

// The Data API needs a Neon Auth JWT. The handler's cached get-session response
// carries only the opaque session token, so the JWT is fetched from /api/auth/token
// and reused until shortly before it expires.
const tokens = createTokenStore();
export const resetDataApiToken = () => tokens.reset();
export const prepareDataApi = () => tokens.get();
const getToken = () => tokens.get();

const data = createClient({ dataApi: { url: process.env.NEXT_PUBLIC_NEON_DATA_API_URL!, getToken } });

export const neon = Object.assign(data, { auth });
