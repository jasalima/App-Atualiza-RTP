import { sql } from './db';
import { clientIp } from './signatures';

/** Fixed window per IP and minute, kept in Postgres (no extra service). Throws 429 above the limit. */
export async function rateLimit(request: Request, bucket: string, perMinute: number) {
  const key = `${bucket}:${clientIp(request) || 'sem-ip'}`;
  const [row] = await sql`INSERT INTO public_rate_limits(bucket,window_start,hits) VALUES(${key},date_trunc('minute',now()),1)
    ON CONFLICT (bucket,window_start) DO UPDATE SET hits=public_rate_limits.hits+1 RETURNING hits`;
  if (Math.random() < 0.02) await sql`DELETE FROM public_rate_limits WHERE window_start < now() - interval '1 day'`;
  if (Number(row.hits) > perMinute) throw Object.assign(new Error('Muitas consultas seguidas. Aguarde um minuto e tente novamente.'), { status: 429 });
}
