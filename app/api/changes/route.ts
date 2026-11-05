import { requireUser, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Live screens. Without "since" it returns the newest event id (the starting point). With it,
// the request waits up to ~25 s and answers as soon as there are newer events in the projects
// the session can see — a long poll: changes reach other open screens in about a second.
const WAIT_MS = 25_000, STEP_MS = 1_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(request: Request) {
  try {
    const { user, mustChangePassword } = await requireUser();
    if (mustChangePassword) return Response.json({ last: null, events: [] });
    const access = await sql`SELECT role,project_id FROM user_project_access WHERE auth_user_id=${user.id}`;
    const admin = access.some((a) => a.role === 'admin');
    const projects = access.filter((a) => a.project_id).map((a) => String(a.project_id));
    // Signature-only accounts follow only the signatures.
    const signerOnly = access.length > 0 && access.every((a) => a.role === 'signer');
    const sinceParam = new URL(request.url).searchParams.get('since');
    let rows;
    try {
      if (sinceParam === null) {
        const [row] = await sql`SELECT coalesce(max(id),0) AS last FROM change_events`;
        return Response.json({ last: Number(row.last), events: [] }, { headers: { 'Cache-Control': 'no-store' } });
      }
      const since = Math.max(0, Number(sinceParam) || 0), until = Date.now() + WAIT_MS;
      do {
        rows = await sql`SELECT id,project_id,entity,entity_id,action FROM change_events WHERE id>${since}
          AND (${admin} OR project_id=ANY(${projects}::uuid[])) AND (NOT ${signerOnly} OR entity='signature_requests')
          ORDER BY id LIMIT 200`;
        if (rows.length || request.signal.aborted) break;
        await sleep(STEP_MS);
      } while (Date.now() < until);
      if (Math.random() < 0.01) await sql`DELETE FROM change_events WHERE at < now() - interval '1 day'`;
    } catch (error) {
      // Feed not installed yet (migration 019 pending): screens keep working without live updates.
      if ((error as { code?: string }).code === '42P01') return Response.json({ last: null, events: [], unavailable: true }, { headers: { 'Cache-Control': 'no-store' } });
      throw error;
    }
    const last = rows.length ? Number(rows[rows.length - 1].id) : Number(sinceParam);
    return Response.json({ last, events: rows.map((r) => ({ projectId: r.project_id ? String(r.project_id) : null, entity: String(r.entity), id: String(r.entity_id), action: String(r.action) })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return routeError(error); }
}
