import { auth } from '@/lib/auth';

// Reports which integrations are configured, never their values.
export async function GET(){
  const {data:session}=await auth.getSession();
  if(!session?.user)return Response.json({error:'Autenticação necessária.'},{status:401});
  const has=(name:string)=>Boolean(process.env[name]?.trim());
  return Response.json({
    database:has('DATABASE_URL'),
    auth:has('NEON_AUTH_BASE_URL')&&has('NEON_AUTH_COOKIE_SECRET'),
    dataApi:has('NEXT_PUBLIC_NEON_DATA_API_URL'),
    storage:has('AWS_ENDPOINT_URL_S3')&&has('AWS_ACCESS_KEY_ID')&&has('AWS_SECRET_ACCESS_KEY'),
    bucket:process.env.NEON_STORAGE_BUCKET||'rtp-private',
    ai:{provider:process.env.AI_PROVIDER||'local',model:process.env.AI_MODEL||null,configured:(process.env.AI_PROVIDER||'local')==='local'||has('AI_API_KEY')}
  });
}
