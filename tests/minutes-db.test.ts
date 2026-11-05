import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleContent } from './fixtures/minute-sample';

// Integration with the real Postgres (Neon): simultaneous signatures of an ata, out of order and
// at the same instant, then the public verification. Runs only with RUN_DB_TESTS=1 and removes
// everything it creates (year 2099 keeps the test numbering apart from real atas).
const run = !!process.env.RUN_DB_TESTS;
if (run) { try { process.loadEnvFile('.env.local'); } catch { /* CI provides the variables */ } }

describe.skipIf(!run)('atas: assinaturas simultâneas no banco real', () => {
  let sql: typeof import('../lib/db').sql, core: typeof import('../lib/minutes-core'), hash: typeof import('../lib/hash'), sign: typeof import('../lib/parallel-sign');
  const ids = { minute: crypto.randomUUID(), version: crypto.randomUUID(), request: crypto.randomUUID(), stress: crypto.randomUUID(), project: '' };
  const users = [1, 2, 3, 4, 5].map((n) => `test-ata-${ids.minute.slice(0, 8)}-${n}`);
  const cpfs = ['52998224725', '11144477735', '39053344705', '16899535009', '86288366757'];
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
    return sign.recordParallelSignature({ requestId, signerId: s.id, userId: users[step - 1], projectId: ids.project, step, cpf: cpfs[step - 1], signedAt, ip, userAgent: 'vitest', documentHash: contentHash, signatureHash });
  }
  const states = (requestId: string) => sql`SELECT step,status,signature_hash FROM signature_signers WHERE request_id=${requestId}::uuid ORDER BY step`;

  beforeAll(async () => {
    ({ sql } = await import('../lib/db')); core = await import('../lib/minutes-core'); hash = await import('../lib/hash'); sign = await import('../lib/parallel-sign');
    const [project] = await sql`SELECT id FROM projects WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`;
    ids.project = String(project.id);
    const content = sampleContent();
    content.number = 'ATA Nº 001/2099';
    contentHash = core.versionHash(ids.version, content); code = core.newPublicCode();
    await sql`INSERT INTO meeting_minutes(id,project_id,year,seq,created_by,subject,status) VALUES(${ids.minute}::uuid,${ids.project}::uuid,2099,1,${users[0]},'Teste de concorrência','finalized')`;
    await sql`INSERT INTO meeting_minute_versions(id,minute_id,version,content,content_hash,public_code,issued_by) VALUES(${ids.version}::uuid,${ids.minute}::uuid,1,${JSON.stringify(content)}::jsonb,${contentHash},${code},${users[0]})`;
    await openRequest(ids.request, ids.version);
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM audit_logs WHERE entity_id IN (${ids.request},${ids.stress})`;
    await sql`DELETE FROM signature_requests WHERE id IN (${ids.request}::uuid,${ids.stress}::uuid)`;
    await sql`DELETE FROM signer_profiles WHERE auth_user_id=ANY(${users})`;
    await sql`DELETE FROM meeting_minute_renders WHERE version_id=${ids.version}::uuid`;
    await sql`DELETE FROM meeting_minute_versions WHERE minute_id=${ids.minute}::uuid`;
    await sql`DELETE FROM meeting_minutes WHERE id=${ids.minute}::uuid`;
  }, 60_000);

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
    expect(v.checks).toEqual({ content: true, signatures: true });
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

  it('G — conteúdo alterado no banco é detectado como falha de integridade', async () => {
    await sql`UPDATE meeting_minute_versions SET content=jsonb_set(content,'{subject}','"Assunto adulterado"') WHERE id=${ids.version}::uuid`;
    expect((await core.verifyMinute(code)).result).toBe('integrity_failure');
    await sql`UPDATE meeting_minute_versions SET content=jsonb_set(content,'{subject}',${JSON.stringify(sampleContent().subject)}::jsonb) WHERE id=${ids.version}::uuid`;
    expect((await core.verifyMinute(code)).result).toBe('signed');
  });

  it('G — assinatura com registro adulterado (IP trocado) invalida a verificação', async () => {
    await sql`UPDATE signature_signers SET ip='203.0.113.9' WHERE request_id=${ids.request}::uuid AND step=1`;
    expect((await core.verifyMinute(code)).result).toBe('integrity_failure');
    await sql`UPDATE signature_signers SET ip='10.0.0.1' WHERE request_id=${ids.request}::uuid AND step=1`;
  });

  it('H — ata cancelada aparece como cancelada; código inexistente como não localizado', async () => {
    await sql`UPDATE meeting_minute_versions SET status='cancelled' WHERE id=${ids.version}::uuid`;
    expect((await core.verifyMinute(code)).result).toBe('cancelled');
    expect((await core.verifyMinute('ABCD-EFGH-JKLM-NPQR')).result).toBe('not_found');
    expect((await core.verifyMinute('qualquer-coisa')).result).toBe('not_found');
  });
});
