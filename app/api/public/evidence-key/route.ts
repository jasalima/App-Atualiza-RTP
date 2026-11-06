import { sql } from '@/lib/db';
import { serverKey } from '@/lib/signature-evidence';
export const runtime = 'nodejs';

// Public keys (Ed25519) that sign the evidence of the electronic signatures: the current one and
// every key used before. Anyone can check an evidence bundle against them, without trusting the
// platform's database. The fingerprint (key id) is also printed in the evidence reports.
export async function GET() {
  const current = serverKey();
  const keys = await sql`SELECT key_id,algorithm,public_key,created_at FROM signature_evidence_keys ORDER BY created_at`;
  return Response.json({
    current: current ? { keyId: current.keyId, algorithm: 'Ed25519', publicKey: current.pem } : null,
    history: keys.map((k) => ({ keyId: k.key_id, algorithm: k.algorithm, publicKey: k.public_key, firstUsedAt: k.created_at })),
    note: 'Assinatura Ed25519 do servidor da plataforma RTP sobre o texto canônico (JSON com chaves ordenadas) de cada evidência. Não é certificado ICP-Brasil.'
  }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
