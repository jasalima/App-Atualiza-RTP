import { beforeEach, describe, expect, it, vi } from 'vitest';

// Atas: everyone receives the ata at once (A); a signature that does not complete sends nothing;
// the last one archives the signed ata and sends it to every participant. Messages go out from
// the number of the person enabled as "Envio das atas pelo WhatsApp", else from who opened it.
const mocks = vi.hoisted(() => ({ query: vi.fn(), load: vi.fn(), send: vi.fn(), put: vi.fn(), sender: vi.fn(), file: vi.fn() }));
vi.mock('../lib/db', () => ({ sql: mocks.query }));
vi.mock('../lib/storage', () => ({ putPrivateObject: mocks.put, readPrivateObject: vi.fn() }));
vi.mock('../lib/whatsapp-connections', () => ({ ownWhatsApp: vi.fn(), moduleSender: mocks.sender }));
vi.mock('../lib/connectivity-config', () => ({ evolutionForProject: async () => ({}) }));
vi.mock('../lib/signatures', () => ({
  loadRequest: mocks.load,
  documentSource: async () => ({ label: 'ATA Nº 001/2026 — Alinhamento do Produto 1.3', scholarId: null, minutes: { public_code: 'K7QM-2XRP-9TFA-H3WD', minute_id: 'minute-1' } }),
  signedFile: mocks.file,
  signerCandidates: async () => ['coord', 'u1', 'u2', 'u3', 'u4', 'u5', 'nilson'].map((id, i) => ({ authUserId: id, name: id === 'coord' ? 'Jaasiel Nascimento Lima' : id === 'nilson' ? 'Nilson Denúncio' : `Participante ${i}`, roleLabel: 'Equipe', phone: id === 'u5' ? '' : `6398400000${i}`, pendingFirstAccess: false })),
  signLink: (id: string) => `https://app.example/assinar/${id}`,
  verifyLink: (code: string) => `https://app.example/verificar/${code}`
}));
import { dispatchAfterSignature } from '../lib/signature-dispatch';

const request = (status: string) => ({ id: 'req', project_id: 'project', source_kind: 'minutes', source_id: 'version-1', created_by: 'coord', status, mode: 'parallel', archived_document_id: null });
const signer = (step: number, status: string, id = `u${step}`) => ({ id: `s${step}`, step, auth_user_id: id, name: id === 'nilson' ? 'Nilson Denúncio' : `Participante ${step}`, role_label: 'Equipe / UFT', status, signed_at: status === 'signed' ? '2026-11-04T19:16:57Z' : null });
const via = (userId: string) => mocks.sender.mockResolvedValue({ userId, designated: userId === 'nilson' ? 'nilson' : null, connection: { instance: `Gesproject-${userId}`, token: 'k' }, provider: { sendDocument: mocks.send } });
beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.query.mockResolvedValue([{ id: 'doc-1' }]);
  mocks.send.mockResolvedValue({ messageId: 'm1' });
  mocks.file.mockResolvedValue({ buffer: Buffer.from('%PDF ata'), mime: 'application/pdf', filename: 'ATA-N-001-2026.pdf' });
  via('coord');
});

describe('envio das atas (assinaturas simultâneas)', () => {
  it('A — ao encaminhar, todos os participantes recebem a ata ao mesmo tempo', async () => {
    mocks.load.mockResolvedValue({ request: request('pending'), signers: [1, 2, 3, 4, 5].map((n) => signer(n, 'pending')) });
    await dispatchAfterSignature('req', 'created');
    expect(mocks.send).toHaveBeenCalledTimes(4); // the fifth has no phone: recorded, not sent
    expect(mocks.send.mock.calls.map((c) => c[3])).toEqual(['5563984000001', '5563984000002', '5563984000003', '5563984000004']);
    expect(mocks.send.mock.calls[2][4]).toContain('✍️ 3. Participante 3 — Equipe / UFT');
    expect(mocks.send.mock.calls[2][4]).toContain('em qualquer ordem');
    expect(mocks.query.mock.calls.some(([s, ...v]) => /audit_logs/.test(s.join('?')) && v.includes('dispatch_skipped'))).toBe(true);
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it('uma assinatura que não conclui só atualiza o PDF oficial, sem mensagens', async () => {
    mocks.load.mockResolvedValue({ request: request('pending'), signers: [signer(1, 'pending'), signer(2, 'signed')] });
    await dispatchAfterSignature('req', 'signed');
    expect(mocks.file).toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('E — a última assinatura arquiva a ata e a envia a todos os participantes', async () => {
    mocks.load.mockResolvedValue({ request: request('completed'), signers: [1, 2, 3].map((n) => signer(n, 'signed')) });
    await dispatchAfterSignature('req', 'signed');
    expect(mocks.put).toHaveBeenCalledWith('project/minutes/minute-1/signed/req.pdf', Buffer.from('%PDF ata'), 'application/pdf');
    expect(mocks.query.mock.calls.some(([s]) => /INSERT INTO documents/.test(s.join('?')) && /'minutes'/.test(s.join('?')))).toBe(true);
    expect(mocks.send.mock.calls.map((c) => c[3])).toEqual(['5563984000001', '5563984000002', '5563984000003']); // who opened it is the sending number
    const caption = mocks.send.mock.calls[0][4];
    expect(caption).toContain('ASSINADO POR TODOS');
    expect(caption).toContain('/verificar-documento/K7QM-2XRP-9TFA-H3WD');
  });
  it('com o responsável pelos envios (Nilson), as mensagens saem do número dele e a ata concluída chega também a quem a abriu', async () => {
    via('nilson');
    mocks.load.mockResolvedValue({ request: request('completed'), signers: [signer(1, 'signed'), signer(2, 'signed', 'nilson')] });
    await dispatchAfterSignature('req', 'signed');
    expect(mocks.send.mock.calls.every((c) => c[0] === 'Gesproject-nilson')).toBe(true);
    expect(mocks.send.mock.calls.map((c) => c[3]).sort()).toEqual(['5563984000000', '5563984000001']); // participant 1 and who opened it; not Nilson himself
  });
  it('sem nenhum WhatsApp conectado, a ata fica arquivada e o motivo é registrado', async () => {
    mocks.sender.mockResolvedValue({ userId: null, designated: 'nilson', connection: null, provider: {} });
    mocks.load.mockResolvedValue({ request: request('completed'), signers: [signer(1, 'signed')] });
    await dispatchAfterSignature('req', 'signed');
    expect(mocks.put).toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.some(([s, ...v]) => /audit_logs/.test(s.join('?')) && v.includes('dispatch_skipped'))).toBe(true);
  });
});
