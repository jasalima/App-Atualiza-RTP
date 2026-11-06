import { sql } from './db';
import { evidenceStatements, PROCEDURE_VERSION, type SignatureEvidence } from './signature-evidence';

export type ParallelSignature = {
  requestId: string; signerId: string; userId: string; projectId: string; step: number; cpf: string;
  signedAt: string; ip: string; userAgent: string; documentHash: string; signatureHash: string; external?: boolean; evidence: SignatureEvidence;
};
/**
 * Records one signature of a simultaneous ('parallel') request in a single transaction.
 * The request row is locked first, so signers who click at the same moment are applied one
 * after the other: each sees the signatures already committed, nothing is overwritten, and
 * only the last one marks the request as completed.
 */
export async function recordParallelSignature(p: ParallelSignature) {
  const mine = sql`EXISTS(SELECT 1 FROM signature_signers WHERE id=${p.signerId}::uuid AND status='signed' AND signature_hash=${p.signatureHash})`;
  const evidence = evidenceStatements(p.evidence, mine);
  const results = await sql.transaction([
    sql`SELECT id FROM signature_requests WHERE id=${p.requestId}::uuid FOR UPDATE`,
    sql`UPDATE signature_signers SET status='signed',cpf=${p.cpf},signed_at=${p.signedAt}::timestamptz,ip=${p.ip},user_agent=${p.userAgent},document_hash=${p.documentHash},signature_hash=${p.signatureHash}
      WHERE id=${p.signerId}::uuid AND status='pending' AND EXISTS(SELECT 1 FROM signature_requests WHERE id=${p.requestId}::uuid AND status='pending') RETURNING id`,
    ...evidence,
    sql`UPDATE signature_requests SET status='completed',completed_at=now() WHERE id=${p.requestId}::uuid AND status='pending' AND ${mine}
      AND NOT EXISTS(SELECT 1 FROM signature_signers WHERE request_id=${p.requestId}::uuid AND status<>'signed') RETURNING id`,
    p.external
      ? sql`UPDATE external_signature_access SET proof_hash=NULL,proof_expires_at=NULL WHERE signer_id=${p.signerId}::uuid AND ${mine}`
      : sql`INSERT INTO signer_profiles(auth_user_id,cpf) SELECT ${p.userId},${p.cpf} WHERE ${mine} ON CONFLICT (auth_user_id) DO NOTHING`,
    sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) SELECT ${p.userId},${p.projectId}::uuid,'sign','signature_request',${p.requestId},
      jsonb_build_object('step',${p.step}::int,'documentHash',${p.documentHash}::text,'signatureHash',${p.signatureHash}::text,'ip',${p.ip}::text,'mode','parallel'::text,'identityMethod',${p.external ? 'cpf_whatsapp_code' : 'account_confirmed_cpf'}::text,'procedure',${PROCEDURE_VERSION}::text) WHERE ${mine}`
  ]) as unknown as Array<Array<{ id: string }>>;
  const updated = results[1], completed = results[2 + evidence.length];
  return { recorded: updated.length > 0, completed: completed.length > 0 };
}
