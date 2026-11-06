import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { sql } from './db';
import { sha256, stableJson } from './hash';
import { CONSENT_TEXTS, type ConsentVersion } from './legal';

/*
 * Evidence of each electronic signature (procedure RTP-ASSINATURA-2).
 *
 * For every signature the server writes one evidence record, in the same transaction that
 * marks the signature: who signed, how the identity was checked, which declaration was
 * accepted, which content (SHA-256) was signed, when (UTC) and from where. The record is:
 *  - canonical JSON (sorted keys), whose SHA-256 the database computes itself (payload_hash);
 *  - signed with the server's Ed25519 key (server_signature), kept outside the database
 *    (EVIDENCE_SIGNING_KEY), so a change made only in the database is detected;
 *  - chained to every earlier record (chain_hash = SHA-256(previous chain_hash | payload_hash)),
 *    so removing or reordering records breaks the chain;
 *  - protected by database triggers against UPDATE, DELETE and TRUNCATE.
 * A hash is not a signature: the hashes show integrity; the Ed25519 signature shows that the
 * record was produced by this platform's key. Neither is an ICP-Brasil certificate or a
 * qualified time stamp.
 */
export const PROCEDURE_VERSION = 'RTP-ASSINATURA-2' as const;

export type AuthEvidence =
  | { method: 'conta_pessoal_cpf_confirmado'; description: string; sessionRef: string | null; sessionStartedAt: string | null; sessionAgeMinutes: number | null; identityConfirmedAt: string | null }
  | { method: 'link_individual_cpf_codigo_whatsapp'; description: string; otpVerifiedAt: string | null; phoneEnding: string };

export type SignatureEvidence = {
  procedure: typeof PROCEDURE_VERSION; event: 'signed';
  document: { kind: string; sourceId: string; label: string; documentHash: string; version?: number | null; publicCode?: string | null };
  request: { id: string; mode: string };
  signer: { signerId: string; step: number; name: string; roleLabel: string; account: string; cpfMasked: string };
  authentication: AuthEvidence;
  consent: { version: ConsentVersion; textSha256: string; accepted: true };
  network: { ip: string; userAgent: string };
  signedAtUtc: string; signatureHash: string;
};

export const maskCpfDigits = (cpf: string) => (/^\d{11}$/.test(cpf) ? `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**` : '');
export const consentEvidence = (version: ConsentVersion) => ({ version, textSha256: sha256(CONSENT_TEXTS[version]), accepted: true as const });
export const evidenceText = (e: SignatureEvidence) => stableJson(e);

/* Server key ----------------------------------------------------------------------------------- */
let cached: { priv: KeyObject; pub: KeyObject; keyId: string; pem: string } | null | undefined;
/** Ed25519 key from EVIDENCE_SIGNING_KEY (PKCS#8, PEM or base64 DER). Without it, evidence is recorded unsigned. */
export function serverKey() {
  if (cached !== undefined) return cached;
  const raw = process.env.EVIDENCE_SIGNING_KEY?.trim();
  if (!raw) return (cached = null);
  const priv = raw.includes('BEGIN') ? createPrivateKey(raw.replace(/\\n/g, '\n')) : createPrivateKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'pkcs8' });
  const pub = createPublicKey(priv), der = pub.export({ format: 'der', type: 'spki' }) as Buffer;
  return (cached = { priv, pub, keyId: sha256(der).slice(0, 16).toUpperCase(), pem: String(pub.export({ format: 'pem', type: 'spki' })) });
}
export const resetServerKeyForTests = () => { cached = undefined; };
export function signEvidence(text: string) {
  const key = serverKey();
  return key ? { signature: sign(null, Buffer.from(text, 'utf8'), key.priv).toString('base64'), keyId: key.keyId, publicKey: key.pem } : { signature: null, keyId: null, publicKey: null };
}
export function verifyEvidenceSignature(text: string, signature: string, publicKeyPem: string) {
  try { return verify(null, Buffer.from(text, 'utf8'), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64')); } catch { return false; }
}

/**
 * Statements that store the evidence of a signature. They run inside the signing transaction
 * and only when `mine` holds (the signer row really changed to signed with this signature hash).
 */
export function evidenceStatements(e: SignatureEvidence, mine: ReturnType<typeof sql>) {
  const text = evidenceText(e), signed = signEvidence(text);
  return [
    ...(signed.keyId ? [sql`INSERT INTO signature_evidence_keys(key_id,algorithm,public_key) VALUES(${signed.keyId},'Ed25519',${signed.publicKey}) ON CONFLICT (key_id) DO NOTHING`] : []),
    sql`INSERT INTO signature_evidence(request_id,signer_id,event,procedure_version,payload,server_signature,key_id)
      SELECT ${e.request.id}::uuid,${e.signer.signerId}::uuid,'signed',${PROCEDURE_VERSION},${text},${signed.signature},${signed.keyId} WHERE ${mine}`
  ];
}

/* Verification ------------------------------------------------------------------------------------ */
type Row = Record<string, unknown>;
export type EvidenceCheck = {
  signerId: string | null; event: string; procedure: string; recordedAt: string; seq: number;
  payloadHashOk: boolean; chainOk: boolean; signature: 'valida' | 'invalida' | 'ausente'; keyId: string | null;
  payloadHash: string; chainHash: string; authMethod: string | null; consentVersion: string | null; signatureHash: string | null; documentHash: string | null;
};
/** Recomputes hashes, the chain link and the Ed25519 signature of every evidence of a request. */
export async function checkEvidence(requestId: string): Promise<EvidenceCheck[]> {
  const rows = await sql`SELECT e.*,k.public_key,p.chain_hash AS previous_chain FROM signature_evidence e
    LEFT JOIN signature_evidence_keys k ON k.key_id=e.key_id LEFT JOIN signature_evidence p ON p.seq=e.seq-1
    WHERE e.request_id=${requestId}::uuid ORDER BY e.seq`;
  return rows.map((r: Row) => {
    const payload = String(r.payload), seq = Number(r.seq);
    const payloadHashOk = sha256(payload) === r.payload_hash;
    const linkOk = seq === 1 ? r.prev_hash === GENESIS : r.previous_chain === r.prev_hash;
    const chainOk = linkOk && sha256(`${r.prev_hash}|${r.payload_hash}`) === r.chain_hash;
    const signature = !r.server_signature ? 'ausente' : r.public_key && verifyEvidenceSignature(payload, String(r.server_signature), String(r.public_key)) ? 'valida' : 'invalida';
    let parsed: Row = {};
    try { parsed = JSON.parse(payload); } catch { /* reported by the hash check */ }
    const auth = parsed.authentication as Row | undefined, consent = parsed.consent as Row | undefined, doc = parsed.document as Row | undefined;
    return {
      signerId: r.signer_id ? String(r.signer_id) : null, event: String(r.event), procedure: String(r.procedure_version), recordedAt: new Date(String(r.recorded_at)).toISOString(), seq,
      payloadHashOk, chainOk, signature, keyId: r.key_id ? String(r.key_id) : null, payloadHash: String(r.payload_hash), chainHash: String(r.chain_hash),
      authMethod: auth?.method ? String(auth.method) : null, consentVersion: consent?.version ? String(consent.version) : null,
      signatureHash: parsed.signatureHash ? String(parsed.signatureHash) : null, documentHash: (doc?.documentHash ?? parsed.documentHash) ? String(doc?.documentHash ?? parsed.documentHash) : null
    } as EvidenceCheck;
  });
}
export const GENESIS = sha256('RTP-EVIDENCIAS-GENESIS');

/** Plain-language result of one signer's evidence, for the public verification. */
export function evidenceVerdict(e: EvidenceCheck | undefined, signer: { signatureHash: string | null; documentHash: string | null }) {
  if (!e) return { level: 'cadastral' as const, text: 'Assinatura registrada antes do procedimento de evidências (nov/2026): conferência cadastral do registro, sem comprovante assinado pelo servidor.' };
  const bound = e.signatureHash === signer.signatureHash && (!signer.documentHash || e.documentHash === signer.documentHash);
  if (!e.payloadHashOk || !e.chainOk || e.signature === 'invalida' || !bound) return { level: 'falha' as const, text: 'As evidências desta assinatura NÃO conferem: o registro foi alterado depois de gravado. Procure a coordenação.' };
  if (e.signature === 'ausente') return { level: 'documental' as const, text: 'Evidências íntegras e encadeadas (hash SHA-256), mas gravadas sem a assinatura Ed25519 do servidor.' };
  return { level: 'criptografica' as const, text: `Evidências íntegras, encadeadas e assinadas pelo servidor (Ed25519, chave ${e.keyId}).` };
}
