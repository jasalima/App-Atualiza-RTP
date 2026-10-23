import { neon } from '@neondatabase/serverless';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';

const isBuild = process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;
const databaseUrl = process.env.DATABASE_URL || (isBuild ? 'postgresql://build:build@localhost/build' : undefined);

if (!databaseUrl) throw new Error('DATABASE_URL não configurada no ambiente de execução.');
export const sql = neon(databaseUrl);
