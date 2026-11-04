import { sql } from '@/lib/db';
import { maskCpf } from '@/server/services/signature-stamp';

// Public check of a signed document by the code printed on its manifest. Shows
// only what the manifest already shows (names, masked CPF, dates and hashes).
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase().replace(/[^0-9A-F]/g, '').replace(/(.{4})(?=.)/g, '$1-');
  if (code.length !== 14) return Response.json({ error: 'Código de verificação inválido.' }, { status: 400 });
  const [request] = await sql`SELECT r.id,r.label,r.status,r.completed_at,r.document_hash,p.title FROM signature_requests r JOIN projects p ON p.id=r.project_id WHERE r.verification_code=${code}`;
  if (!request) return Response.json({ error: 'Nenhum documento assinado com este código.' }, { status: 404 });
  const signers = await sql`SELECT step,name,role_label,cpf,signed_at,signature_hash FROM signature_signers WHERE request_id=${request.id}::uuid AND status='signed' ORDER BY step`;
  return Response.json({
    code, label: request.label, project: request.title, valid: request.status === 'completed', status: request.status,
    completedAt: request.completed_at, documentHash: request.document_hash,
    signers: signers.map((s) => ({ step: s.step, name: s.name, roleLabel: s.role_label, cpf: maskCpf(String(s.cpf)), signedAt: s.signed_at, signatureHash: s.signature_hash }))
  }, { headers: { 'Cache-Control': 'no-store' } });
}
