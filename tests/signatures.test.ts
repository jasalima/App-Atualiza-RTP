import { beforeEach, describe, expect, it, vi } from 'vitest';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

// SQL mock: each tagged call is answered by the first handler whose pattern matches the query text.
type Handler = [RegExp, (values: unknown[]) => unknown];
const mocks = vi.hoisted(() => ({ handlers: [] as Array<[RegExp, (values: unknown[]) => unknown]>, calls: [] as Array<{ q: string; values: unknown[] }>, user: vi.fn(), transaction: vi.fn(), after: vi.fn() }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('../lib/signature-dispatch', () => ({ dispatchAfterSignature: vi.fn(async () => {}) }));
vi.mock('../lib/db', () => {
  const sql = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join('?');
    mocks.calls.push({ q, values });
    const hit = mocks.handlers.find(([re]) => re.test(q));
    return Promise.resolve(hit ? hit[1](values) : []);
  }, { transaction: mocks.transaction });
  return { sql };
});
vi.mock('../lib/auth', () => ({ auth: { getSession: async () => ({ data: mocks.user() }) } }));
vi.mock('../lib/storage', () => ({ readPrivateObject: vi.fn(), signedDownloadUrl: async () => 'https://storage.example/photo', signedUploadUrl: vi.fn(), headPrivateObject: vi.fn() }));

import { normalizeCpf, stableJson, documentSource, assertUnsigned } from '../lib/signatures';
import { requireProject } from '../lib/authorize';
import { POST as sign } from '../app/api/signatures/[id]/sign/route';
import { GET as verify } from '../app/api/signatures/verify/[code]/route';
import { travelDocx, travelPdf } from '../server/services/travel-export';
import { toPdf } from '../server/services/export';
import type { SignatureManifest } from '../server/services/signature-stamp';

const requestId = '6f1f8a52-1d3a-4f53-9d55-1d7f0f0f0001', projectId = '10ab6e37-f57e-41e0-8218-6f69d51c33c4', reportId = '8a539a45-bf0f-4c9b-9bed-fcbb7ef6d2b1';
const travelRow = { id: reportId, project_id: projectId, scholar_id: 'scholar-1', full_name: 'Eliane Marques', origin: 'Palmas/TO', destination: 'Lagoa da Confusão/TO', departure_date: '2026-10-21', return_date: '2026-10-23', payment_date: null, objective: 'Visita técnica', entries: [{ date: '2026-10-21', activity: 'Reunião' }], photos: [], status: 'draft', created_at: 'x', updated_at: 'x' };
const scholar = { full_name: 'Eliane Marques', role_area: 'Assessora', phone: '5563999925840', email: 'eliane@example.com', title: 'Projeto', agreement: '7886-6 Convênio' };
const signer = (step: number, status: string, extra: Record<string, unknown> = {}) => ({ id: `signer-${step}`, step, auth_user_id: `user-${step}`, name: step === 1 ? 'Eliane Marques' : 'Francisco Gilson', role_label: step === 1 ? 'Assessora' : 'Coordenador do projeto', status, cpf: null, signed_at: null, ip: null, user_agent: null, document_hash: null, signature_hash: null, reject_reason: null, ...extra });
const request = (status = 'pending') => ({ id: requestId, project_id: projectId, source_kind: 'travel', source_id: reportId, label: 'Formulário 26', status });

function db(o: { signers: ReturnType<typeof signer>[]; profile?: string; role?: string }) {
  const handlers: Handler[] = [
    [/FROM managed_users WHERE auth_user_id/, () => []],
    [/SELECT \* FROM signature_requests WHERE id=/, () => [request()]],
    [/SELECT \* FROM signature_signers WHERE request_id=/, () => o.signers],
    [/FROM user_project_access WHERE auth_user_id=\?.*coordinator/, () => (o.role ? [{ '?column?': 1 }] : [])],
    [/FROM signer_identities/, () => [{ cpf: o.profile ?? (mocks.user().user.id === 'user-2' ? '11144477735' : '52998224725') }]],
    [/FROM travel_reports t JOIN scholars/, () => [travelRow]],
    [/FROM scholars s JOIN projects p/, () => [scholar]]
  ];
  mocks.handlers.splice(0, mocks.handlers.length, ...handlers);
}
const post = async (cpf = mocks.user().user.id === 'user-2' ? '111.444.777-35' : '529.982.247-25', documentHash?: string) => {
  const source = await documentSource(projectId, 'travel', reportId);
  return sign(new Request(`https://app.example/api/signatures/${requestId}/sign`, { method: 'POST', headers: { origin: 'https://app.example', 'x-forwarded-for': '200.10.20.30, 10.0.0.1', 'user-agent': 'Vitest' }, body: JSON.stringify({ cpf, accept: true, documentHash: documentHash ?? source.hash }) }), { params: Promise.resolve({ id: requestId }) });
};

beforeEach(() => {
  mocks.calls.length = 0; mocks.transaction.mockReset(); mocks.after.mockReset();
  mocks.transaction.mockResolvedValue([[], [{ id: 'signer-1' }], [], [], []]);
  mocks.user.mockReturnValue({ user: { id: 'user-1', email: 'eliane@example.com' } });
});

describe('CPF and content hash', () => {
  it('accepts only CPFs with valid check digits', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
    expect(normalizeCpf('529.982.247-24')).toBeNull();
    expect(normalizeCpf('111.111.111-11')).toBeNull();
    expect(normalizeCpf('123')).toBeNull();
  });
  it('hashes the same content identically regardless of key order', () => {
    expect(stableJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(stableJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
  it('changes the document hash when the content changes', async () => {
    db({ signers: [] });
    const before = await documentSource(projectId, 'travel', reportId);
    travelRow.objective = 'Visita técnica alterada';
    const after = await documentSource(projectId, 'travel', reportId);
    travelRow.objective = 'Visita técnica';
    expect(before.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(after.hash).not.toBe(before.hash);
  });
});

describe('signature-only accounts', () => {
  it('cannot reach project routes', async () => {
    mocks.handlers.splice(0, mocks.handlers.length, [/FROM managed_users/, () => []], [/FROM user_project_access/, () => [{ role: 'signer', scholar_id: 's1' }]]);
    await expect(requireProject(projectId)).rejects.toMatchObject({ status: 403 });
  });
});

describe('signing', () => {
  it('records CPF, IP, time and hash and passes the turn to the next signer', async () => {
    db({ signers: [signer(1, 'pending'), signer(2, 'waiting')] });
    const response = await post();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.completed).toBe(false);
    expect(body.signatureHash).toMatch(/^[0-9a-f]{64}$/);
    const [statements] = mocks.transaction.mock.calls[0];
    expect(statements).toHaveLength(5);
    const update = mocks.calls.find((c) => /UPDATE signature_signers SET status='signed'/.test(c.q))!;
    expect(update.values).toContain('52998224725');
    expect(update.values).toContain('200.10.20.30');
    expect(mocks.calls.some((c) => /UPDATE signature_signers SET status='pending'/.test(c.q) && c.values.includes('signer-2'))).toBe(true);
    // The next signer is notified after the response, not while the signer waits.
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });
  it('completes the request with a verification code on the last signature', async () => {
    mocks.user.mockReturnValue({ user: { id: 'user-2' } });
    db({ signers: [signer(1, 'signed', { cpf: '52998224725', document_hash: 'x', signature_hash: 'h1' }), signer(2, 'pending')] });
    // The first signer signed another hash: content changed after the first signature.
    expect((await post()).status).toBe(409);
    const source = await documentSource(projectId, 'travel', reportId);
    db({ signers: [signer(1, 'signed', { cpf: '52998224725', document_hash: source.hash, signature_hash: 'h1' }), signer(2, 'pending')] });
    const body = await (await post()).json();
    expect(body.completed).toBe(true);
    expect(body.verificationCode).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(mocks.calls.some((c) => /UPDATE signature_requests SET status='completed'/.test(c.q))).toBe(true);
  });
  it('follows the order and refuses double signing', async () => {
    mocks.user.mockReturnValue({ user: { id: 'user-2' } });
    db({ signers: [signer(1, 'pending'), signer(2, 'waiting')] });
    expect((await post()).status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    mocks.user.mockReturnValue({ user: { id: 'user-1' } });
    db({ signers: [signer(1, 'pending'), signer(2, 'waiting')] });
    mocks.transaction.mockResolvedValue([[], [], [], []]);
    expect((await post()).status).toBe(409);
  });
  it('rejects an invalid CPF or one different from the registered identity', async () => {
    db({ signers: [signer(1, 'pending'), signer(2, 'waiting')] });
    expect((await post('123.456.789-00')).status).toBe(400);
    db({ signers: [signer(1, 'pending'), signer(2, 'waiting')], profile: '11144477735' });
    expect((await post()).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('refuses to sign a version changed since the signer reviewed it', async () => {
    db({ signers: [signer(1, 'pending')] });
    expect((await post('52998224725', 'b'.repeat(64))).status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('belongs only to its signers and the project team', async () => {
    mocks.user.mockReturnValue({ user: { id: 'stranger' } });
    db({ signers: [signer(1, 'pending')] });
    expect((await post()).status).toBe(403);
  });
});

describe('editing lock and public verification', () => {
  it('blocks edits once a signature exists', async () => {
    mocks.handlers.splice(0, mocks.handlers.length, [/FROM signature_requests r WHERE r.source_kind/, () => [{ status: 'pending' }]]);
    await expect(assertUnsigned('travel', reportId)).rejects.toMatchObject({ status: 409 });
    mocks.handlers.splice(0, mocks.handlers.length);
    await expect(assertUnsigned('travel', reportId)).resolves.toBeUndefined();
  });
  it('normalizes the code and masks CPFs', async () => {
    mocks.handlers.splice(0, mocks.handlers.length,
      [/FROM signature_requests r JOIN projects/, (v) => (v[0] === 'ABCD-1234-EF56' ? [{ id: requestId, label: 'Doc', status: 'completed', completed_at: '2026-11-04T12:00:00Z', document_hash: 'h', title: 'Projeto' }] : [])],
      [/FROM signature_signers WHERE request_id/, () => [{ step: 1, name: 'Eliane', role_label: 'Assessora', cpf: '52998224725', signed_at: '2026-11-04T12:00:00Z', signature_hash: 'h1' }]]);
    const res = await verify(new Request('https://app.example'), { params: Promise.resolve({ code: 'abcd1234ef56' }) });
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.signers[0].cpf).toBe('***.982.247-**');
    expect(JSON.stringify(body)).not.toContain('52998224725');
  });
});

describe('signed exports', () => {
  const manifest: SignatureManifest = { label: 'Formulário 26 — Eliane', status: 'completed', documentHash: 'a'.repeat(64), verificationCode: 'ABCD-1234-EF56', verifyUrl: 'https://app.example/verificar/ABCD-1234-EF56',
    signers: [{ step: 1, name: 'Eliane Marques', roleLabel: 'Assessora', cpf: '52998224725', signedAt: '2026-11-04T15:30:00Z', ip: '200.10.20.30', signatureHash: 'b'.repeat(64) }, { step: 2, name: 'Francisco Gilson', roleLabel: 'Coordenador do projeto', cpf: '11144477735', signedAt: '2026-11-04T16:00:00Z', ip: '200.10.20.31', signatureHash: 'c'.repeat(64) }] };
  const b = { name: 'Eliane Marques', phone: '5563999925840', email: '', project: 'Projeto', role: 'Assessora' };
  it('stamps the signature rows and adds the manifest to Form 26', async () => {
    const docx = (await mammoth.extractRawText({ buffer: await travelDocx(b, { departure: '2026-10-21', signatures: manifest }) })).value;
    const pdf = (await pdfParse(await travelPdf(b, { departure: '2026-10-21', signatures: manifest }))).text;
    for (const text of [docx, pdf]) {
      expect(text).toContain('Assinado eletronicamente por Eliane Marques em 04/11/2026 às 12:30:00');
      expect(text).toContain('Assinado eletronicamente por Francisco Gilson');
      expect(text).toContain('MANIFESTO DE ASSINATURAS ELETRÔNICAS');
      expect(text).toContain('ABCD-1234-EF56');
      // Banknote-style seals: five audit lines, green beneficiary and gold coordination.
      expect(text).toContain('ASSINADO ELETRONICAMENTE POR:');
      expect(text).toContain('ELIANE MARQUES');
      expect(text).toContain(`Hash: ${'b'.repeat(64)}`);
      expect(text).toMatch(/ELIANE MARQUES\s+·\s+04\/11\/2026 às 12:30:00/);
      expect(text).toContain('IP da máquina: 200.10.20.30');
      expect(text).toContain('BENEFICIÁRIO');
      expect(text).toContain('COORDENAÇÃO DO PROJETO');
      expect(text).toContain('***.982.247-**');
      expect(text).toContain('200.10.20.30');
      expect(text).not.toContain('52998224725');
    }
  });
  it('keeps the unsigned form as before', async () => {
    const docx = (await mammoth.extractRawText({ buffer: await travelDocx(b, {}) })).value;
    expect(docx).not.toContain('MANIFESTO');
    expect(docx).toContain('Assinatura do beneficiário: ____');
  });
  it('adds the stamp and manifest to the RTP', async () => {
    const content = { heading: { foundation: 'Fundação', form: 'FORMULÁRIO 9', title: 'RTP', project: 'Projeto', scholar: 'Eliane', scholarshipPeriod: '2026', number: '01/2026' }, sections: { results: 'a', comparison: 'b', additional: 'c' }, closing: { placeAndDate: 'Palmas – TO', scholar: 'Eliane', role: 'Assessora' }, pending: [] };
    const pdf = (await pdfParse(await toPdf(content, manifest))).text;
    expect(pdf).toContain('MANIFESTO DE ASSINATURAS ELETRÔNICAS');
    expect(pdf).toContain('Assinado eletronicamente por Eliane Marques');
  });
});

describe('travel report timestamps', () => {
  it('keeps updatedAt as an ISO instant Postgres can compare (Date from the driver)', async () => {
    const { travelReportRow } = await import('../lib/travel');
    const row = travelReportRow({ ...travelRow, created_at: new Date('2026-11-05T19:53:00.001Z'), updated_at: new Date('2026-11-05T19:54:41.152Z') });
    expect(row.updatedAt).toBe('2026-11-05T19:54:41.152Z');
  });
});
