import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from '@neondatabase/serverless';

// Syntax and security tests run in one rolled-back transaction on an isolated branch.
// Never pass a production endpoint here.
process.loadEnvFile('.env.local');
const endpoint = process.argv[2];
if (endpoint !== 'ep-sparkling-wildflower-b4rl7zt8') throw new Error('Use somente o endpoint da branch de validação desta alteração.');
const connection = new URL(process.env.DATABASE_URL);
connection.hostname = connection.hostname.replace(/^ep-[^.]+/, endpoint);
const pool = new Pool({ connectionString: connection.toString() });
const client = await pool.connect();
let checks = 0;
try {
  await client.query('BEGIN');
  await client.query(fs.readFileSync('database/migrations/018_signature_identity.sql', 'utf8'));
  const project = (await client.query('SELECT id FROM projects WHERE deleted_at IS NULL LIMIT 1')).rows[0];
  assert(project, 'Projeto de teste disponível na branch');
  const userA = `test-identity-${randomUUID()}`, userB = `test-identity-${randomUUID()}`;
  await client.query('INSERT INTO signer_identities(auth_user_id,cpf,verified_by) VALUES ($1,$2,$1),($3,$4,$1)', [userA, '52998224725', userB, '11144477735']);
  const rejected = async (query, values, code) => {
    await client.query('SAVEPOINT attack');
    try { await client.query(query, values); assert.fail('A operação deveria ser rejeitada.'); }
    catch (error) { assert.equal(error.code, code); checks++; }
    finally { await client.query('ROLLBACK TO SAVEPOINT attack'); await client.query('RELEASE SAVEPOINT attack'); }
  };
  await rejected('INSERT INTO signer_identities(auth_user_id,cpf,verified_by) VALUES ($1,$2,$1)', [`other-${randomUUID()}`, '52998224725'], '23505');
  const req = randomUUID(), signer = randomUUID(), scholarId = randomUUID(), reportId = randomUUID();
  await client.query('INSERT INTO scholars(id,project_id,full_name,starts_on,ends_on) VALUES($1,$2,$3,\'2099-01-01\',\'2099-12-31\')', [scholarId, project.id, `Teste ${scholarId}`]);
  await client.query('INSERT INTO reports(id,project_id,scholar_id,number,period_start,period_end,issued_on) VALUES($1,$2,$3,\'999999/2099\',\'2099-01-01\',\'2099-01-31\',\'2099-02-01\')', [reportId, project.id, scholarId]);
  await client.query('INSERT INTO signature_requests(id,project_id,source_kind,source_id,label,created_by) VALUES($1,$2,\'rtp\',$3,\'Teste de identidade\',$4)', [req, project.id, reportId, userA]);
  await client.query('INSERT INTO signature_signers(id,request_id,step,auth_user_id,name,status) VALUES($1,$2,1,$3,\'Pessoa de teste\',\'pending\')', [signer, req, userA]);
  await client.query('UPDATE reports SET current_version=2 WHERE id=$1', [reportId]); checks++;
  await rejected('UPDATE signature_signers SET status=\'signed\',cpf=$2 WHERE id=$1', [signer, '11144477735'], '23514');
  await client.query('UPDATE signature_signers SET status=\'signed\',cpf=$2 WHERE id=$1', [signer, '52998224725']); checks++;
  await rejected('UPDATE reports SET current_version=3 WHERE id=$1', [reportId], '23514');
  const guestRequest = randomUUID(), guestSigner = randomUUID();
  await client.query('INSERT INTO signature_requests(id,project_id,source_kind,source_id,label,created_by,mode) VALUES($1,$2,\'minutes\',$3,\'Teste externo\',$4,\'parallel\')', [guestRequest, project.id, randomUUID(), userA]);
  await client.query('INSERT INTO signature_signers(id,request_id,step,auth_user_id,name,status) VALUES($1,$2,1,$3,\'Convidado de teste\',\'pending\')', [guestSigner, guestRequest, `external:${randomUUID()}`]);
  await client.query('INSERT INTO external_signature_access(signer_id,cpf,phone,token_hash,encrypted_token) VALUES($1,$2,$3,$4,\'test-only\')', [guestSigner, '39053344705', '5563999999999', 'a'.repeat(64)]);
  await rejected('UPDATE signature_signers SET status=\'signed\',cpf=$2 WHERE id=$1', [guestSigner, '39053344705'], '23514');
  await client.query('UPDATE external_signature_access SET proof_hash=$2,proof_expires_at=now()+interval \'10 minutes\' WHERE signer_id=$1', [guestSigner, 'b'.repeat(64)]);
  await rejected('UPDATE signature_signers SET status=\'signed\',cpf=$2 WHERE id=$1', [guestSigner, '52998224725'], '23514');
  await client.query('UPDATE external_signature_access SET proof_expires_at=now()-interval \'1 second\' WHERE signer_id=$1', [guestSigner]);
  await rejected('UPDATE signature_signers SET status=\'signed\',cpf=$2 WHERE id=$1', [guestSigner, '39053344705'], '23514');
  await client.query('UPDATE external_signature_access SET proof_expires_at=now()+interval \'10 minutes\' WHERE signer_id=$1', [guestSigner]);
  await client.query('UPDATE signature_requests SET status=\'cancelled\' WHERE id=$1', [guestRequest]);
  await rejected('UPDATE signature_signers SET status=\'signed\',cpf=$2 WHERE id=$1', [guestSigner, '39053344705'], '23514');
  await client.query('UPDATE signature_requests SET status=\'pending\' WHERE id=$1', [guestRequest]);
  await client.query('UPDATE signature_signers SET status=\'signed\',cpf=$2 WHERE id=$1', [guestSigner, '39053344705']); checks++;
  await client.query('ROLLBACK');
  console.log(`Migração e ${checks} verificações de identidade: OK. Transação revertida; produção não alterada.`);
} finally { await client.query('ROLLBACK').catch(() => {}); client.release(); await pool.end(); }
