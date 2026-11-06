import { sql } from '@/lib/db';
import { maskCpf } from '@/server/services/signature-stamp';
import { documentSource, type SignatureKind } from '@/lib/signatures';
import { checkEvidence, evidenceVerdict } from '@/lib/signature-evidence';
import { signatureHashOf } from '@/lib/hash';
import { checkKindOf } from '@/lib/minutes-core';

// Public check of a signed document by the code printed on its manifest. Shows only what the
// manifest already shows (names, masked CPF, dates and hashes) plus what was checked, and how:
//  - signatures: each signature hash recomputed from its record (documental);
//  - evidence: hashes, chain and Ed25519 server signature of the evidence (criptográfica), or
//    "cadastral" for signatures given before the evidence procedure existed;
//  - content: the document as it is today compared with the hash that was signed.
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d));
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase().replace(/[^0-9A-F]/g, '').replace(/(.{4})(?=.)/g, '$1-');
  if (code.length !== 14) return Response.json({ error: 'Código de verificação inválido.' }, { status: 400 });
  const [request] = await sql`SELECT r.id,r.label,r.status,r.completed_at,r.document_hash,r.project_id,r.source_kind,r.source_id,r.closed_reason,p.title,d.sha256 AS file_sha256
    FROM signature_requests r JOIN projects p ON p.id=r.project_id LEFT JOIN documents d ON d.id=r.archived_document_id AND d.deleted_at IS NULL WHERE r.verification_code=${code}`;
  if (!request) return Response.json({ error: 'Nenhum documento assinado com este código.' }, { status: 404 });
  const signers = await sql`SELECT id,step,auth_user_id,name,role_label,cpf,signed_at,ip,document_hash,signature_hash FROM signature_signers WHERE request_id=${request.id}::uuid AND status='signed' ORDER BY step`;
  const evidence = await checkEvidence(String(request.id));
  const people = signers.map((s) => {
    const recomputed = signatureHashOf({ documentHash: String(s.document_hash), requestId: String(request.id), step: Number(s.step), userId: String(s.auth_user_id), cpf: String(s.cpf), signedAt: iso(s.signed_at), ip: String(s.ip ?? '') });
    const record = s.document_hash === request.document_hash && recomputed === s.signature_hash;
    const proof = evidenceVerdict(evidence.find((e) => e.event === 'signed' && e.signerId === String(s.id)), { signatureHash: String(s.signature_hash), documentHash: String(request.document_hash) });
    return { step: s.step, name: s.name, roleLabel: s.role_label, cpf: maskCpf(String(s.cpf)), signedAt: s.signed_at, signatureHash: s.signature_hash, recordOk: record, evidence: proof };
  });
  // The document as it is today (it may have been deleted later: then only the records are checked).
  let content: 'confere' | 'alterado' | 'indisponivel' = 'indisponivel';
  try { content = (await documentSource(String(request.project_id), request.source_kind as SignatureKind, String(request.source_id))).hash === request.document_hash ? 'confere' : 'alterado'; } catch { /* source no longer available */ }
  const eventsOk = evidence.filter((e) => e.event !== 'signed').every((e) => e.payloadHashOk && e.chainOk && e.signature !== 'invalida');
  const integrity = people.every((p) => p.recordOk && p.evidence.level !== 'falha') && eventsOk && content !== 'alterado';
  return Response.json({
    code, label: request.label, project: request.title, valid: request.status === 'completed' && integrity, status: request.status, closedReason: request.status === 'cancelled' ? request.closed_reason : null,
    completedAt: request.completed_at, documentHash: request.document_hash, fileSha256: request.file_sha256 ?? null,
    checks: { records: people.every((p) => p.recordOk), evidence: eventsOk && people.every((p) => p.evidence.level !== 'falha'), content },
    checkKind: checkKindOf(people.map((p) => p.evidence.level)), checkedAt: new Date().toISOString(),
    signers: people.map(({ recordOk: _r, ...p }) => p)
  }, { headers: { 'Cache-Control': 'no-store' } });
}
