import { Pool, type QueryResultRow } from '@neondatabase/serverless';
import { config } from '../config.js';

export const db = new Pool({ connectionString: config.DATABASE_URL, max: 10 });
export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return db.query<T>(text, values);
}
