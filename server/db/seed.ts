import { db } from './index.js';

const authUserId=process.env.NEON_ADMIN_USER_ID;
const email=process.env.NEON_ADMIN_EMAIL;
const name=process.env.NEON_ADMIN_NAME;
if(!authUserId||!email||!name)throw new Error('Defina NEON_ADMIN_USER_ID, NEON_ADMIN_EMAIL e NEON_ADMIN_NAME após criar a conta no Neon Auth.');
const client=await db.connect();
try {
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO user_project_access(auth_user_id,project_id,role)
     VALUES($1,NULL,'admin')
     ON CONFLICT (auth_user_id,project_id)
     DO UPDATE SET role='admin'`,
    [authUserId],
  );
  await client.query(
    `INSERT INTO managed_users(auth_user_id,name,email,must_change_password)
     VALUES($1,$2,$3,false)
     ON CONFLICT(auth_user_id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,revoked_at=NULL`,
    [authUserId,name,email],
  );
  await client.query('COMMIT');
} catch(error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
console.log('Acesso administrativo associado à conta Neon Auth.');
await db.end();
