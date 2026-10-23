import { db } from './index.js';

const authUserId=process.env.NEON_ADMIN_USER_ID;
if(!authUserId)throw new Error('Defina NEON_ADMIN_USER_ID após criar a conta no Neon Auth.');
await db.query(
  `INSERT INTO user_project_access(auth_user_id,project_id,role)
   VALUES($1,NULL,'admin')
   ON CONFLICT (auth_user_id,project_id)
   DO UPDATE SET role='admin'`,
  [authUserId],
);
console.log('Acesso administrativo associado à conta Neon Auth.');
await db.end();
