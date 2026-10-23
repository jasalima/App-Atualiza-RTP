'use client';

import { createClient } from '@neondatabase/neon-js';
import { BetterAuthReactAdapter } from '@neondatabase/neon-js/auth/react/adapters';

export const neon = createClient({
  auth: {
    adapter: BetterAuthReactAdapter(),
    url: process.env.NEXT_PUBLIC_NEON_AUTH_URL!
  },
  dataApi: {
    url: process.env.NEXT_PUBLIC_NEON_DATA_API_URL!
  }
});
