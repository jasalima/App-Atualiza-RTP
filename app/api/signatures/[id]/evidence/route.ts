import { sql } from '@/lib/db';
import { requestAccess } from '@/lib/signatures';
import { GENESIS, PROCEDURE_VERSION } from '@/lib/signature-evidence';
import { travelError } from '@/lib/travel';
export const runtime = 'nodejs';

// Evidence bundle of one signature request, for the coordination to hand to an institution or a
// court: the exact evidence texts, their hashes, the chain links and the server signatures, plus
// the public keys. It contains personal data (IP, browser) and is therefore not public; it can be
// verified offline with scripts/verificar-evidencias.mjs, without access to the platform.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params, access = await requestAccess(id);
    if (!access.manager) throw Object.assign(new Error('Somente a coordenação do projeto exporta as evidências.'), { status: 403 });
    const rows = await sql`SELECT e.seq,e.event,e.procedure_version,e.signer_id,e.payload,e.payload_hash,e.prev_hash,e.chain_hash,e.server_signature,e.key_id,e.recorded_at,
        p.chain_hash AS previous_chain_hash FROM signature_evidence e LEFT JOIN signature_evidence p ON p.seq=e.seq-1 WHERE e.request_id=${id}::uuid ORDER BY e.seq`;
    const keys = await sql`SELECT key_id,algorithm,public_key FROM signature_evidence_keys WHERE key_id=ANY(${rows.map((r) => r.key_id).filter(Boolean)})`;
    await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${access.user.id},${access.request.project_id}::uuid,'export_evidence','signature_request',${id},jsonb_build_object('records',${rows.length}::int))`;
    const bundle = {
      format: 'RTP-EVIDENCIAS-1', procedure: PROCEDURE_VERSION, exportedAt: new Date().toISOString(), requestId: id, label: access.request.label,
      genesis: GENESIS, chainRule: 'chain_hash = SHA-256(prev_hash + "|" + payload_hash); payload_hash = SHA-256(payload em UTF-8)',
      signatureRule: 'server_signature = Ed25519(payload em UTF-8), em base64, verificável com a chave pública indicada por key_id',
      evidence: rows.map((r) => ({ ...r, recorded_at: new Date(String(r.recorded_at)).toISOString() })),
      keys: keys.map((k) => ({ keyId: k.key_id, algorithm: k.algorithm, publicKey: k.public_key }))
    };
    return new Response(JSON.stringify(bundle, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="evidencias-${id.slice(0, 8)}.json"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) { return travelError(error); }
}
