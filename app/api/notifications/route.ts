import { requireUser, routeError } from '@/lib/authorize';
import { sql } from '@/lib/db';
import { minuteNumber } from '@/lib/minutes-model';
import { reclaimSignerSlots } from '@/lib/signatures';

// The bell: what is waiting for the person (signatures to give, refused requests) and what
// they follow (requests they opened, atas being written, recently completed signatures).
type Item = { id: string; kind: 'sign' | 'rejected' | 'waiting' | 'completed' | 'draft'; title: string; detail: string; link: string; at: string; action: boolean };
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d));
const documentLink = (kind: string, sourceId: string, minuteId: string | null) => kind === 'minutes' && minuteId ? `/atas/${minuteId}` : kind === 'travel' ? `/travel/${sourceId}` : kind === 'rtp' ? `/reports/${sourceId}` : '/assinaturas';

export async function GET() {
  try {
    const { user, mustChangePassword } = await requireUser();
    if (mustChangePassword) return Response.json({ items: [], pending: 0 });
    await reclaimSignerSlots(user);
    const [toSign, mine, drafts] = await Promise.all([
      sql`SELECT r.id,r.label,r.created_at,r.mode FROM signature_signers s JOIN signature_requests r ON r.id=s.request_id
        WHERE s.auth_user_id=${user.id} AND s.status='pending' AND r.status='pending' ORDER BY r.created_at DESC LIMIT 30`,
      sql`SELECT r.id,r.label,r.status,r.source_kind,r.source_id,r.created_at,r.completed_at,r.closed_reason,v.minute_id,
          (SELECT count(*) FROM signature_signers x WHERE x.request_id=r.id) AS total,(SELECT count(*) FROM signature_signers x WHERE x.request_id=r.id AND x.status='signed') AS signed
        FROM signature_requests r LEFT JOIN meeting_minute_versions v ON r.source_kind='minutes' AND v.id=r.source_id
        WHERE r.created_by=${user.id} AND (r.status='pending' OR (r.status IN ('completed','rejected') AND coalesce(r.completed_at,r.created_at) > now() - interval '7 days'))
        ORDER BY r.created_at DESC LIMIT 30`,
      sql`SELECT id,seq,year,subject,updated_at FROM meeting_minutes WHERE created_by=${user.id} AND status IN ('draft','editing') AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 10`
    ]);
    const items: Item[] = [
      ...toSign.map((r) => ({ id: `sign:${r.id}`, kind: 'sign' as const, title: 'Documento aguardando a sua assinatura', detail: String(r.label), link: `/assinar/${r.id}`, at: iso(r.created_at), action: true })),
      ...mine.map((r) => {
        const link = documentLink(String(r.source_kind), String(r.source_id), r.minute_id ? String(r.minute_id) : null);
        if (r.status === 'rejected') return { id: `rejected:${r.id}`, kind: 'rejected' as const, title: 'Assinatura recusada', detail: `${r.label}${r.closed_reason ? ` — ${r.closed_reason}` : ''}`, link, at: iso(r.completed_at ?? r.created_at), action: true };
        if (r.status === 'completed') return { id: `done:${r.id}`, kind: 'completed' as const, title: 'Assinado por todos', detail: String(r.label), link, at: iso(r.completed_at ?? r.created_at), action: false };
        return { id: `wait:${r.id}`, kind: 'waiting' as const, title: `Aguardando assinaturas (${r.signed} de ${r.total})`, detail: String(r.label), link, at: iso(r.created_at), action: false };
      }),
      ...drafts.map((m) => ({ id: `draft:${m.id}`, kind: 'draft' as const, title: 'Ata em elaboração', detail: `${minuteNumber(Number(m.seq), Number(m.year))}${m.subject ? ` — ${m.subject}` : ''}`, link: `/atas/${m.id}`, at: iso(m.updated_at), action: false }))
    ];
    return Response.json({ items, pending: items.filter((i) => i.action).length }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return routeError(error); }
}
