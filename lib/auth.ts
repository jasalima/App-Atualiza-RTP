import { createNeonAuth } from '@neondatabase/neon-js/auth/next/server';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';

const isBuild = process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;
const baseUrl = process.env.NEON_AUTH_BASE_URL ?? (isBuild ? 'https://build.invalid/auth' : undefined);
const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET ?? (isBuild ? 'build-only-placeholder-never-used-at-runtime' : undefined);

if (!baseUrl) throw new Error('NEON_AUTH_BASE_URL não configurada no ambiente de execução.');
if (!cookieSecret) throw new Error('NEON_AUTH_COOKIE_SECRET não configurada no ambiente de execução.');

export const auth = createNeonAuth({
  baseUrl,
  cookies: {
    secret: cookieSecret,
    sessionDataTtl: 300
  }
});
