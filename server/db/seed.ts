import { db } from './index.js';

const authUserId=process.env.NEON_ADMIN_USER_ID,projectId=process.env.NEON_ADMIN_PROJECT_ID;
if(!authUserId||!projectId)throw new Error('Defina NEON_ADMIN_USER_ID e NEON_ADMIN_PROJECT_ID após criar a conta no Neon Auth.');
await db.query(`INSERT INTO user_project_access(auth_user_id,project_id,role) VALUES($1,$2,'admin') ON CONFLICT(auth_user_id,project_id) DO UPDATE SET role='admin'`,[authUserId,projectId]);
console.log('Acesso administrativo associado à conta Neon Auth.');
await db.end();
