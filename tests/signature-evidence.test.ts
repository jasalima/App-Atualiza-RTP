import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Evidence rows returned by the mocked database for checkEvidence.
const state = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock('../lib/db', () => ({ sql: Object.assign(async () => state.rows, { transaction: async () => [] }) }));
vi.mock('../lib/auth', () => ({ auth: { getSession: async () => ({ data: null }) } }));
import { sha256 } from '../lib/hash';
import { CONSENT_TEXT, CONSENT_TEXTS, CONSENT_VERSION, isConsentVersion } from '../lib/legal';
import { checkEvidence, consentEvidence, evidenceText, evidenceVerdict, GENESIS, maskCpfDigits, PROCEDURE_VERSION, resetServerKeyForTests, signEvidence, verifyEvidenceSignature, type SignatureEvidence } from '../lib/signature-evidence';
import { signingSessionCheck, MAX_SIGNING_SESSION_HOURS } from '../lib/signature-session';

const key = generateKeyPairSync('ed25519');
const pem = String(key.privateKey.export({ format: 'pem', type: 'pkcs8' }));
const evidence: SignatureEvidence = {
  procedure: PROCEDURE_VERSION, event: 'signed', document: { kind: 'travel', sourceId: 's1', label: 'Formulário 26', documentHash: 'a'.repeat(64) }, request: { id: 'r1', mode: 'sequential' },
  signer: { signerId: 'sg1', step: 1, name: 'Eliane', roleLabel: 'Assessora', account: 'u1', cpfMasked: maskCpfDigits('52998224725') },
  authentication: { method: 'conta_pessoal_cpf_confirmado', description: 'x', sessionRef: 'abc', sessionStartedAt: null, sessionAgeMinutes: 5, identityConfirmedAt: null },
  consent: consentEvidence(CONSENT_VERSION), network: { ip: '200.10.20.30', userAgent: 'test' }, signedAtUtc: '2026-11-06T12:00:00.000Z', signatureHash: 'b'.repeat(64)
};
/** Builds chained rows exactly as the database trigger does. */
function chain(payloads: string[], signed = true) {
  let prev = GENESIS;
  return payloads.map((payload, i) => {
    const payload_hash = sha256(payload), chain_hash = sha256(`${prev}|${payload_hash}`);
    const sig = signed ? signEvidence(payload) : { signature: null, keyId: null, publicKey: null };
    const row = { seq: i + 1, request_id: 'r1', signer_id: 'sg1', event: 'signed', procedure_version: PROCEDURE_VERSION, payload, payload_hash, prev_hash: prev, chain_hash, server_signature: sig.signature, key_id: sig.keyId, public_key: sig.publicKey, recorded_at: '2026-11-06T12:00:01Z', previous_chain: i ? null : null };
    prev = chain_hash; return row;
  }).map((r, i, all) => ({ ...r, previous_chain: i ? all[i - 1].chain_hash : null }));
}

beforeEach(() => { process.env.EVIDENCE_SIGNING_KEY = pem; resetServerKeyForTests(); state.rows = []; });

describe('declaração de vontade', () => {
  it('usa o texto exigido e aceita só versões conhecidas', () => {
    expect(CONSENT_TEXT).toMatch(/^Declaro que li e estou ciente do conteúdo integral deste documento/);
    expect(consentEvidence(CONSENT_VERSION).textSha256).toBe(sha256(CONSENT_TEXTS[CONSENT_VERSION]));
    expect(isConsentVersion('DECL-2026-11')).toBe(true);
    expect(isConsentVersion('qualquer')).toBe(false);
    expect(isConsentVersion('toString')).toBe(false);
  });
});

describe('evidências', () => {
  it('assina com Ed25519 e detecta qualquer alteração do registro', () => {
    const text = evidenceText(evidence), s = signEvidence(text);
    expect(s.keyId).toMatch(/^[0-9A-F]{16}$/);
    expect(verifyEvidenceSignature(text, s.signature!, s.publicKey!)).toBe(true);
    expect(verifyEvidenceSignature(text.replace('200.10.20.30', '203.0.113.9'), s.signature!, s.publicKey!)).toBe(false);
    expect(text).not.toContain('52998224725');
  });
  it('JSON canônico: a mesma evidência gera sempre o mesmo texto', () => {
    expect(evidenceText({ ...evidence })).toBe(evidenceText(JSON.parse(JSON.stringify(evidence))));
  });
  it('confere hash, encadeamento e assinatura do servidor', async () => {
    state.rows = chain([evidenceText(evidence), evidenceText({ ...evidence, signer: { ...evidence.signer, step: 2, signerId: 'sg2' } })]);
    const checks = await checkEvidence('r1');
    expect(checks.every((c) => c.payloadHashOk && c.chainOk && c.signature === 'valida')).toBe(true);
    expect(evidenceVerdict(checks[0], { signatureHash: 'b'.repeat(64), documentHash: 'a'.repeat(64) }).level).toBe('criptografica');
  });
  it('payload adulterado no banco: hash não confere', async () => {
    const rows = chain([evidenceText(evidence)]);
    rows[0].payload = String(rows[0].payload).replace('Eliane', 'Outra pessoa');
    state.rows = rows;
    const [c] = await checkEvidence('r1');
    expect(c.payloadHashOk).toBe(false);
    expect(evidenceVerdict(c, { signatureHash: 'b'.repeat(64), documentHash: null }).level).toBe('falha');
  });
  it('payload e hash refeitos no banco: a assinatura do servidor denuncia', async () => {
    const rows = chain([evidenceText(evidence)]);
    const forged = String(rows[0].payload).replace('Eliane', 'Outra pessoa');
    rows[0].payload = forged; rows[0].payload_hash = sha256(forged); rows[0].chain_hash = sha256(`${GENESIS}|${sha256(forged)}`);
    state.rows = rows;
    const [c] = await checkEvidence('r1');
    expect(c.payloadHashOk && c.chainOk).toBe(true);
    expect(c.signature).toBe('invalida');
    expect(evidenceVerdict(c, { signatureHash: 'b'.repeat(64), documentHash: null }).level).toBe('falha');
  });
  it('registro anterior removido ou trocado: o encadeamento quebra', async () => {
    const rows = chain([evidenceText(evidence), evidenceText({ ...evidence, signatureHash: 'c'.repeat(64) })]);
    rows[1].previous_chain = 'f'.repeat(64);
    state.rows = [rows[1]];
    const [c] = await checkEvidence('r1');
    expect(c.chainOk).toBe(false);
  });
  it('evidência de outra assinatura não serve para esta', async () => {
    state.rows = chain([evidenceText(evidence)]);
    const [c] = await checkEvidence('r1');
    expect(evidenceVerdict(c, { signatureHash: 'd'.repeat(64), documentHash: null }).level).toBe('falha');
  });
  it('sem chave configurada: registra sem assinatura e informa conferência apenas por hash', async () => {
    delete process.env.EVIDENCE_SIGNING_KEY; resetServerKeyForTests();
    expect(signEvidence('x').signature).toBeNull();
    state.rows = chain([evidenceText(evidence)], false);
    const [c] = await checkEvidence('r1');
    expect(c.signature).toBe('ausente');
    expect(evidenceVerdict(c, { signatureHash: 'b'.repeat(64), documentHash: null }).level).toBe('documental');
  });
  it('assinatura antiga, sem evidência: conferência cadastral, sem atribuir controles que não existiam', () => {
    const v = evidenceVerdict(undefined, { signatureHash: 'b'.repeat(64), documentHash: null });
    expect(v.level).toBe('cadastral');
    expect(v.text).toMatch(/antes do procedimento/);
  });
});

describe('sessão usada para assinar', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  it('aceita login recente e guarda só o resumo da sessão', () => {
    const r = signingSessionCheck({ id: 'sessao-secreta', createdAt: '2026-11-06T10:00:00Z', impersonatedBy: null }, now);
    expect(r.sessionAgeMinutes).toBe(120);
    expect(r.sessionRef).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(r)).not.toContain('sessao-secreta');
  });
  it(`exige novo login depois de ${MAX_SIGNING_SESSION_HOURS} horas`, () => {
    expect(() => signingSessionCheck({ id: 's', createdAt: '2026-11-05T20:00:00Z', impersonatedBy: null }, now)).toThrow(/login feito há menos de 12 horas/);
  });
  it('recusa sessão de administrador personificando outra conta', () => {
    expect(() => signingSessionCheck({ id: 's', createdAt: '2026-11-06T11:00:00Z', impersonatedBy: 'admin-1' }, now)).toThrow(/personificação/);
  });
});
