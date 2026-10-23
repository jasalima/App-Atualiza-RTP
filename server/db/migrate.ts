import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from './index.js';

const dir = path.resolve('database/migrations');
await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, run_at timestamptz NOT NULL DEFAULT now())');
for (const name of (await fs.readdir(dir)).filter((x) => x.endsWith('.sql')).sort()) {
  const done = await db.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
  if (done.rowCount) continue;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(await fs.readFile(path.join(dir, name), 'utf8'));
    await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
    await client.query('COMMIT');
    console.log(`Applied ${name}`);
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
await db.end();
