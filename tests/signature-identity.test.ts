import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ sql: vi.fn(), parallel: vi.fn(), source: vi.fn(), sender: vi.fn() }));
vi.mock('../lib/db', () => ({ sql: mocks.sql }));
vi.mock('../lib/parallel-sign', () => ({ recordParallelSignature: mocks.parallel }));
vi.mock('../lib/whatsapp-connections', () => ({ moduleSender: mocks.sender }));
vi.mock('../lib/signatures', () => ({ documentSource: mocks.source, clientIp: () => '192.0.2.1' }));
import { assertSignerIdentity } from '../lib/signature-identity';
import { externalCapability, challengeDigest, hasExternalProof, proofCookieName, secureEqual, sendExternalChallenge, signExternal, verifyExternalChallenge } from '../lib/external-signatures';
import { sha256 } from '../lib/hash';
import { freezeContent, emptyDraft } from '../lib/minutes-model';

const access = (extra = {}) => ({ signer_id: 'guest-1', request_id: 'request-1', auth_user_id: 'external:guest-1', name: 'Convidado', cpf: '52998224725', phone: '5563999999999', signer_status: 'pending', request_status: 'pending', project_id: 'p', source_id: 'v', created_by: 'u', step: 1, proof_hash: null, proof_expires_at: null, ...extra });
beforeEach(() => { vi.clearAllMocks(); mocks.sql.mockResolvedValue([]); vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'test-only-secret-with-more-than-32-characters'); });
describe('identidade de membros', () => {
  it('não permite escolher CPF no primeiro uso sem confirmação administrativa', async () => {
    await expect(assertSignerIdentity('account-a', '52998224725')).rejects.toMatchObject({ status: 409 });
  });
  it('impede usar CPF de outra pessoa mesmo com uma conta autenticada', async () => {
    mocks.sql.mockResolvedValue([{ cpf: '11144477735' }]);
    await expect(assertSignerIdentity('account-a', '52998224725')).rejects.toMatchObject({ status: 403 });
    await expect(assertSignerIdentity('account-a', '111.444.777-35')).resolves.toBe('11144477735');
  });
});
describe('assinatura externa', () => {
  it('gera capacidades imprevisíveis e não guarda o link em texto puro no hash', () => {
    const a = externalCapability(), b = externalCapability();
    expect(a.token).toHaveLength(43); expect(a.token).not.toBe(b.token); expect(a.hash).toBe(sha256(a.token)); expect(a.hash).not.toBe(a.token);
    expect(challengeDigest(a.token, '123456')).not.toBe(challengeDigest(b.token, '123456'));
    expect(secureEqual('a', 'aa')).toBe(false);
  });
  it('CPF correto sem confirmação pelo WhatsApp não permite assinar', async () => {
    await expect(signExternal(new Request('https://app.example'), access(), '52998224725')).rejects.toMatchObject({ status: 403 });
    expect(mocks.parallel).not.toHaveBeenCalled();
  });
  it('CPF diferente do cadastrado ou pertencente a uma conta interna é recusado', async () => {
    await expect(signExternal(new Request('https://app.example'), access(), '11144477735')).rejects.toMatchObject({ status: 403 });
    mocks.sql.mockResolvedValue([{ '?column?': 1 }]);
    await expect(signExternal(new Request('https://app.example'), access(), '52998224725')).rejects.toMatchObject({ status: 403 });
    expect(mocks.parallel).not.toHaveBeenCalled();
  });
  it('não aceita prova de outro convidado ou prova expirada', () => {
    const a = access({ proof_hash: sha256('proof-a'), proof_expires_at: '2099-01-01' });
    expect(hasExternalProof(new Request('https://app.example', { headers: { cookie: `${proofCookieName(a)}=proof-b` } }), a)).toBe(false);
    expect(hasExternalProof(new Request('https://app.example', { headers: { cookie: `${proofCookieName(a)}=proof-a` } }), { ...a, proof_expires_at: '2000-01-01' })).toBe(false);
  });
  it('código incorreto ou esgotado não gera prova de identidade', async () => {
    mocks.sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ challenge_hash: challengeDigest('token', '111111') }]);
    await expect(verifyExternalChallenge('token', access(), '52998224725', '222222')).rejects.toMatchObject({ status: 403 });
    expect(mocks.sql).toHaveBeenCalledTimes(2);
  });
  it('um link cancelado não permite assinar e não chama o registro', async () => {
    await expect(signExternal(new Request('https://app.example'), access({ request_status: 'cancelled' }), '52998224725')).rejects.toMatchObject({ status: 409 });
    expect(mocks.parallel).not.toHaveBeenCalled();
  });
  it('limita reenvios antes de acionar o WhatsApp', async () => {
    await expect(sendExternalChallenge('token', access(), '52998224725')).rejects.toMatchObject({ status: 429 });
    expect(mocks.sender).not.toHaveBeenCalled();
  });
  it('envia o código só ao telefone cadastrado e troca um código correto por prova privada', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'example' });
    mocks.sender.mockResolvedValue({ connection: { instance: 'demo', token: 'not-a-real-token' }, provider: { sendText: send } });
    mocks.sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ signer_id: 'guest-1' }]);
    const result = await sendExternalChallenge('individual-token', access(), '52998224725');
    expect(result).not.toHaveProperty('code'); expect(send.mock.calls[0][2]).toBe('5563999999999');
    const code = /código de confirmação é (\d{6})/.exec(send.mock.calls[0][3])![1];
    mocks.sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ challenge_hash: challengeDigest('individual-token', code) }]).mockResolvedValueOnce([{ signer_id: 'guest-1' }]);
    const proof = await verifyExternalChallenge('individual-token', access(), '52998224725', code);
    expect(proof).toHaveLength(43);
  });
  it('registra a assinatura verificada com o mesmo hash e mecanismo de atas', async () => {
    const a = access({ proof_hash: sha256('proof'), proof_expires_at: '2099-01-01' });
    mocks.source.mockResolvedValue({ hash: 'a'.repeat(64) }); mocks.parallel.mockResolvedValue({ recorded: true, completed: true });
    const request = new Request('https://app.example', { headers: { cookie: `${proofCookieName(a)}=proof` } });
    await expect(signExternal(request, a, '52998224725')).resolves.toMatchObject({ signed: true, completed: true });
    expect(mocks.parallel).toHaveBeenCalledWith(expect.objectContaining({ external: true, userId: 'external:guest-1', cpf: '52998224725', documentHash: 'a'.repeat(64) }));
  });
  it('não inclui CPF e telefone do convidado no conteúdo público emitido', () => {
    const draft = emptyDraft(); draft.participants = [{ scholarId: null, authUserId: null, name: 'Convidado', institution: '', role: '', email: 'guest@example.invalid', cpf: '52998224725', phone: '5563999999999', attendance: 'guest', signs: true }];
    const frozen = JSON.stringify(freezeContent(draft, { number: 'ATA Nº 001/2026', projectTitle: 'Exemplo' }));
    expect(frozen).not.toContain('52998224725'); expect(frozen).not.toContain('5563999999999'); expect(frozen).not.toContain('guest@example.invalid');
  });
});
