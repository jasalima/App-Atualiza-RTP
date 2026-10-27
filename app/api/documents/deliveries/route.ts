import { z } from 'zod';
import { requireProject } from '../../../../lib/authorize';
import { sql } from '../../../../lib/db';
import { travelError } from '../../../../lib/travel';

// Send status of every document of the project, so the archive shows what
// already went out and nothing is sent twice. Members see only their own sends.
export async function GET(request: Request) {
  try {
    const projectId = z.string().uuid().parse(new URL(request.url).searchParams.get('projectId'));
    const session = await requireProject(projectId);
    const own = session.role === 'scholar';
    const rows = await sql`SELECT source_kind,source_id,
        max(created_at) FILTER (WHERE status='accepted') AS sent_at,
        max(source_version) FILTER (WHERE status='accepted') AS sent_version,
        count(*) FILTER (WHERE status='accepted')::int AS sent_count,
        bool_or(status='uncertain' OR (status='sending' AND created_at<now()-interval '2 minutes')) AS uncertain,
        bool_or(status='sending' AND created_at>=now()-interval '2 minutes') AS sending
      FROM document_deliveries WHERE project_id=${projectId}::uuid AND (${own}::boolean IS FALSE OR auth_user_id=${session.user.id})
      GROUP BY source_kind,source_id`;
    return Response.json(rows.map((r) => ({
      kind: String(r.source_kind), id: String(r.source_id), sentAt: r.sent_at ? new Date(r.sent_at as string).toISOString() : null,
      sentVersion: r.sent_version == null ? null : Number(r.sent_version), sentCount: Number(r.sent_count), uncertain: Boolean(r.uncertain), sending: Boolean(r.sending)
    })), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
