import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleContent } from './fixtures/minute-sample';

// Integration with a real Postgres (Neon): simultaneous signatures of an ata, out of order and
// at the same instant, the evidence chain, the database guards and the public verification.
// Signed records cannot be deleted (by design), so it runs only against a disposable Neon
// branch: RUN_DB_TESTS=1 and TEST_DATABASE_URL pointing to that branch — never production.
const run = !!process.env.RUN_DB_TESTS && !!process.env.TEST_DATABASE_URL;
if (run) { try { process.loadEnvFile('.env.local'); } catch { /* CI provides the variables */ } process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; }

describe.skipIf(!run)('atas: assinaturas simultâneas no banco real', () => {
  let sql: typeof import('../lib/db').sql, core: typeof import('../lib/minutes-core'), hash: typeof import('../lib/hash'), sign: typeof import('../lib/parallel-sign'), ev: typeof import('../lib/signature-evidence');
  const ids = { minute: crypto.randomUUID(), version: crypto.randomUUID(), request: crypto.randomUUID(), stress: crypto.randomUUID(), project: '' };
  const users = [1, 2, 3, 4, 5].map((n) => `test-ata-${ids.minute.slice(0, 8)}-${n}`);
  // Valid CPFs drawn per run: a CPF is bound to one account, and earlier runs stay on the branch.
  const cpf = () => { const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)); for (const n of [10, 11]) { const s = d.reduce((a, x, i) => a + x * (n - i), 0); d.push(((s * 10) % 11) % 10); } return d.join(''); };
  const cpfs = [1, 2, 3, 4, 5].map(cpf);
  let code = '', contentHash = '';
  const signers: Record<string, Array<{ id: string; step: number }>> = {};

  async function openRequest(requestId: string, sourceId: string) {
    await sql`INSERT INTO signature_requests(id,project_id,source_kind,source_id,label,created_by,mode,document_hash) VALUES(${requestId}::uuid,${ids.project}::uuid,'minutes',${sourceId}::uuid,'ATA Nº 001/2099 — teste',${users[0]},'parallel',${contentHash})`;
    for (let i = 0; i < 5; i++) await sql`INSERT INTO signature_signers(request_id,step,auth_user_id,name,role_label,status) VALUES(${requestId}::uuid,${i + 1},${users[i]},${`Participante ${i + 1}`},'Teste / UFT','pending')`;
    signers[requestId] = (await sql`SELECT id,step FROM signature_signers WHERE request_id=${requestId}::uuid ORDER BY step`).map((r) => ({ id: String(r.id), step: Number(r.step) }));
  }
  function signAs(requestId: string, step: number, signedAt = new Date().toISOString()) {
    const s = signers[requestId][step - 1], ip = `10.0.0.${step}`;
    const signatureHash = hash.signatureHashOf({ documentHash: contentHash, requestId, step, userId: users[step - 1], cpf: cpfs[step - 1], signedAt, ip });
    const evidence = { procedure: ev.PROCEDURE_VERSION, event: 'signed' as const, document: { kind: 'minutes', sourceId: ids.version, label: 'ATA Nº 001/2099', documentHash: contentHash }, request: { id: requestId, mode: 'parallel' },
      signer: { signerId: s.id, step, name: `Participante ${step}`, roleLabel: 'Teste', account: users[step - 1], cpfMasked: ev.maskCpfDigits(cpfs[step - 1]) },
      authentication: { method: 'conta_pessoal_cpf_confirmado' as const, description: 'teste', sessionRef: null, sessionStartedAt: null, sessionAgeMinutes: null, identityConfirmedAt: null },
      consent: ev.consentEvidence('DECL-2026-11'), network: { ip, userAgent: 'vitest' }, signedAtUtc: signedAt, signatureHash };
    return sign.recordParallelSignature({ requestId, signerId: s.id, userId: users[step - 1], projectId: ids.project, step, cpf: cpfs[step - 1], signedAt, ip, userAgent: 'vitest', documentHash: contentHash, signatureHash, evidence });
  }
  const states = (requestId: string) => sql`SELECT step,status,signature_hash FROM signature_signers WHERE request_id=${requestId}::uuid ORDER BY step`;

  beforeAll(async () => {
    ({ sql } = await import('../lib/db')); core = await import('../lib/minutes-core'); hash = await import('../lib/hash'); sign = await import('../lib/parallel-sign'); ev = await import('../lib/signature-evidence');
    // The identity guard requires the CPF of each test account to be confirmed.
    for (let i = 0; i < 5; i++) await sql`INSERT INTO signer_identities(auth_user_id,cpf,verified_by) VALUES(${users[i]},${cpfs[i]},'vitest') ON CONFLICT DO NOTHING`;
    const [project] = await sql`SELECT id FROM projects WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`;
    ids.project = String(project.id);
    const content = sampleContent();
    content.number = 'ATA Nº 001/2099';
    contentHash = core.versionHash(ids.version, content); code = core.newPublicCode();
    await sql`INSERT INTO meeting_minutes(id,project_id,year,seq,created_by,subject,status) VALUES(${ids.minute}::uuid,${ids.project}::uuid,2099,${1 + Math.floor(Math.random() * 9000)},${users[0]},'Teste de concorrência','finalized')`;
    await sql`INSERT INTO meeting_minute_versions(id,minute_id,version,content,content_hash,public_code,issued_by) VALUES(${ids.version}::uuid,${ids.minute}::uuid,1,${JSON.stringify(content)}::jsonb,${contentHash},${code},${users[0]})`;
    await openRequest(ids.request, ids.version);
  }, 60_000);

  // No cleanup: signed records and evidence are undeletable by design; the test branch is discarded.

  it('A — a solicitação nasce com os cinco participantes pendentes ao mesmo tempo', async () => {
    expect((await states(ids.request)).map((s) => s.status)).toEqual(['pending', 'pending', 'pending', 'pending', 'pending']);
    const v = await core.verifyMinute(code);
    expect(v.result).toBe('unsigned');
    expect(v.signatures).toEqual({ done: 0, total: 5 });
  });

  it('B/D — assinaturas fora de ordem (4, 2, 5) ficam válidas e a ata aparece parcialmente assinada', async () => {
    for (const step of [4, 2, 5]) expect(await signAs(ids.request, step)).toEqual({ recorded: true, completed: false });
    expect((await states(ids.request)).map((s) => s.status)).toEqual(['pending', 'signed', 'pending', 'signed', 'signed']);
    const v = await core.verifyMinute(code);
    expect(v.result).toBe('partial');
    expect(v.signatures).toEqual({ done: 3, total: 5 });
    expect(v.checks).toEqual({ content: true, signatures: true, evidence: true });
    expect(JSON.stringify(v)).not.toMatch(/10\.0\.0|52998224725|test-ata/); // no IP, CPF or internal ids
  });

  it('C — dois participantes assinando no mesmo instante: nada se perde e só um conclui', async () => {
    const before = (await states(ids.request)).filter((s) => s.status === 'signed').map((s) => s.signature_hash);
    const results = await Promise.all([signAs(ids.request, 1), signAs(ids.request, 3)]);
    expect(results.every((r) => r.recorded)).toBe(true);
    expect(results.filter((r) => r.completed)).toHaveLength(1);
    const after = await states(ids.request);
    expect(after.every((s) => s.status === 'signed')).toBe(true);
    expect(after.filter((s) => before.includes(s.signature_hash))).toHaveLength(3); // earlier signatures untouched
    const [r] = await sql`SELECT status,document_hash FROM signature_requests WHERE id=${ids.request}::uuid`;
    expect(r).toMatchObject({ status: 'completed', document_hash: contentHash });
  });

  it('C — repetir uma assinatura não grava de novo', async () => {
    expect(await signAs(ids.request, 2)).toEqual({ recorded: false, completed: false });
  });

  it('E — com as cinco assinaturas a verificação pública mostra o documento íntegro e totalmente assinado', async () => {
    const v = await core.verifyMinute(code.toLowerCase().replace(/-/g, ' '));
    expect(v.result).toBe('signed');
    expect(v.signatures).toEqual({ done: 5, total: 5 });
    expect(v.signers!.every((s) => s.status === 'signed' && s.signatureId)).toBe(true);
  });

  it('C — cinco assinaturas disparadas de uma vez numa nova solicitação', async () => {
    await openRequest(ids.stress, crypto.randomUUID());
    const results = await Promise.all([1, 2, 3, 4, 5].map((step) => signAs(ids.stress, step)));
    expect(results.every((r) => r.recorded)).toBe(true);
    expect(results.filter((r) => r.completed)).toHaveLength(1);
    const [r] = await sql`SELECT status FROM signature_requests WHERE id=${ids.stress}::uuid`;
    expect(r.status).toBe('completed');
  }, 60_000);

  it('G — o banco recusa alterar o conteúdo emitido, uma assinatura dada ou as evidências', async () => {
    await expect(sql`UPDATE meeting_minute_versions SET content=jsonb_set(content,'{subject}','"Assunto adulterado"') WHERE id=${ids.version}::uuid`).rejects.toThrow(/não pode ser alterada/);
    await expect(sql`UPDATE signature_signers SET ip='203.0.113.9' WHERE request_id=${ids.request}::uuid AND step=1`).rejects.toThrow(/não pode ser alterada/);
    await expect(sql`DELETE FROM signature_signers WHERE request_id=${ids.request}::uuid AND step=1`).rejects.toThrow(/não pode ser excluída/);
    await expect(sql`DELETE FROM signature_requests WHERE id=${ids.request}::uuid`).rejects.toThrow();
    await expect(sql`UPDATE signature_requests SET document_hash=repeat('0',64) WHERE id=${ids.request}::uuid`).rejects.toThrow(/apenas cancelada/);
    await expect(sql`UPDATE signature_evidence SET payload='{}' WHERE request_id=${ids.request}::uuid`).rejects.toThrow(/não podem ser alterados/);
    await expect(sql`DELETE FROM signature_evidence WHERE request_id=${ids.request}::uuid`).rejects.toThrow(/não podem ser alterados/);
    await expect(sql`UPDATE signature_evidence_head SET seq=0`).rejects.toThrow(/não podem ser alterados/);
    expect((await core.verifyMinute(code)).result).toBe('signed');
  });

  it('G — cada assinatura tem evidência íntegra, encadeada e vinculada ao hash da versão', async () => {
    const checks = await ev.checkEvidence(ids.request);
    const signed = checks.filter((c) => c.event === 'signed');
    expect(signed).toHaveLength(5);
    expect(checks.every((c) => c.payloadHashOk && c.chainOk)).toBe(true);
    expect(signed.every((c) => c.documentHash === contentHash && c.consentVersion === 'DECL-2026-11')).toBe(true);
    expect(checks.some((c) => c.event === 'request_completed')).toBe(true);
    const v = await core.verifyMinute(code);
    expect(v.checks).toMatchObject({ evidence: true });
    expect(['criptografica', 'documental']).toContain(v.checkKind);
  });

  it('H — ata cancelada aparece como cancelada; código inexistente como não localizado', async () => {
    await sql`UPDATE meeting_minute_versions SET status='cancelled' WHERE id=${ids.version}::uuid`;
    expect((await core.verifyMinute(code)).result).toBe('cancelled');
    expect((await core.verifyMinute('ABCD-EFGH-JKLM-NPQR')).result).toBe('not_found');
    expect((await core.verifyMinute('qualquer-coisa')).result).toBe('not_found');
  });
});
