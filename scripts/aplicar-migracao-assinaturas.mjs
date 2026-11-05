import fs from 'node:fs';
import { Pool } from '@neondatabase/serverless';

// Explicit release step, after tests and deployment build; only migration 018 is applied.
if (process.argv[2] !== '--production') throw new Error('Informe --production somente no procedimento de publicação.');
process.loadEnvFile('.env.local');
const connection = new URL(process.env.DATABASE_URL);
connection.hostname = connection.hostname.replace('-pooler.', '.');
const pool = new Pool({ connectionString: connection.toString() }), client = await pool.connect();
const name = '018_signature_identity.sql';
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('rtp-signature-identity-migration'))");
  const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
  if (!applied.rowCount) {
    await client.query(fs.readFileSync(`database/migrations/${name}`, 'utf8'));
    await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
  }
  await client.query('COMMIT');
  const tables = await client.query("SELECT to_regclass('signer_identities') IS NOT NULL AS identities,to_regclass('external_signature_access') IS NOT NULL AS external");
  console.log(JSON.stringify({ migration: name, applied: !applied.rowCount, verified: tables.rows[0] }));
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await pool.end(); }
