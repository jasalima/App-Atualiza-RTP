import { sql } from '@/lib/db';
import { verifyLink } from '@/lib/signatures';
import { minuteVerifyLink, normalizePublicCode } from '@/lib/minutes-core';
import { minuteNumber } from '@/lib/minutes-model';
import { rateLimit } from '@/lib/rate-limit';
import { travelError } from '@/lib/travel';
import { evidenceReport } from '@/server/services/evidence-report';
export const runtime = 'nodejs';

// Public "comprovante técnico de assinaturas" of a document, by the code printed on it: the
// 12-character code of travel reports and RTPs, or the 16-character public code of an ata.
// Shows the same personal data as the public verification (masked CPF, no IP).
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    await rateLimit(request, 'evidence-report', 20);
    const raw = (await params).code;
    const short = raw.toUpperCase().replace(/[^0-9A-F]/g, '').replace(/(.{4})(?=.)/g, '$1-');
    let input: Parameters<typeof evidenceReport>[0] | null = null;
    if (short.length === 14) {
      const [r] = await sql`SELECT r.id,r.label,r.status,r.document_hash,p.title FROM signature_requests r JOIN projects p ON p.id=r.project_id WHERE r.verification_code=${short}`;
      if (r) input = { requestId: String(r.id), documentLabel: String(r.label), project: String(r.title), code: short, verifyUrl: verifyLink(short), status: String(r.status), documentHash: r.document_hash ? String(r.document_hash) : null };
    }
    const code = input ? null : normalizePublicCode(raw);
    if (code) {
      const [r] = await sql`SELECT r.id,r.status,r.document_hash,v.version,v.issued_at,v.content_hash,m.seq,m.year,m.subject,p.title FROM meeting_minute_versions v JOIN meeting_minutes m ON m.id=v.minute_id JOIN projects p ON p.id=m.project_id
        JOIN signature_requests r ON r.source_kind='minutes' AND r.source_id=v.id WHERE v.public_code=${code} ORDER BY (r.status IN ('pending','completed')) DESC, r.created_at DESC LIMIT 1`;
      if (r) input = { requestId: String(r.id), documentLabel: `Ata de Reunião ${minuteNumber(Number(r.seq), Number(r.year))} — ${r.subject}`, project: String(r.title), code, verifyUrl: minuteVerifyLink(code), status: String(r.status), documentHash: String(r.document_hash ?? r.content_hash), version: Number(r.version), issuedAt: new Date(String(r.issued_at)).toISOString() };
    }
    if (!input) return Response.json({ error: 'Nenhum documento com assinaturas para este código.' }, { status: 404 });
    const pdf = await evidenceReport(input);
    return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="comprovante-assinaturas-${input.code}.pdf"`, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  } catch (error) { return travelError(error); }
}
