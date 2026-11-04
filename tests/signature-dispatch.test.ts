import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), load: vi.fn(), send: vi.fn(), put: vi.fn(), state: vi.fn(), own: vi.fn() }));
vi.mock('../lib/db', () => ({ sql: mocks.query }));
vi.mock('../lib/storage', () => ({ putPrivateObject: mocks.put }));
vi.mock('../lib/whatsapp-connections', () => ({ ownWhatsApp: mocks.own }));
vi.mock('../lib/connectivity-config', () => ({ evolutionForProject: async () => ({ state: mocks.state, sendDocument: mocks.send }) }));
vi.mock('../lib/signatures', () => ({
  loadRequest: mocks.load,
  documentSource: async () => ({ label: 'Formulário 26 — Relatório de Viagem a Lagoa da Confusão/TO — Jaasiel', scholarId: 'scholar-1' }),
  signedFile: async () => ({ buffer: Buffer.from('%PDF signed'), mime: 'application/pdf', filename: 'formulario-26-jaasiel.pdf' }),
  signerCandidates: async () => [
    { authUserId: 'admin', name: 'Jaasiel Nascimento Lima', roleLabel: 'Assistente de Gestão', phone: '5563984031162', pendingFirstAccess: false },
    { authUserId: 'coord', name: 'Francisco Gilson Rebouças Porto Junior', roleLabel: 'Coordenador do projeto', phone: '63984028033', pendingFirstAccess: true }
  ],
  signLink: (id: string) => `https://app.example/assinar/${id}`,
  verifyLink: (code: string) => `https://app.example/verificar/${code}`
}));
import { dispatchAfterSignature } from '../lib/signature-dispatch';

const request = (status: string) => ({ id: 'req', project_id: 'project', source_kind: 'travel', source_id: 'report', created_by: 'admin', status, verification_code: status === 'completed' ? 'ABCD-1234-EF56' : null, archived_document_id: null });
const signer = (step: number, id: string, name: string, status: string) => ({ id: `s${step}`, step, auth_user_id: id, name, status, signed_at: status === 'signed' ? '2026-11-04T19:16:57Z' : null });
beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.query.mockResolvedValue([{ id: 'doc-1' }]);
  mocks.own.mockResolvedValue({ instance: 'Gesproject-admin', token: 'k' });
  mocks.state.mockResolvedValue('open');
  mocks.send.mockResolvedValue({ messageId: 'm1' });
});

describe('after each signature', () => {
  it('sends the coordinator the PDF already signed by the member, with the link', async () => {
    mocks.load.mockResolvedValue({ request: request('pending'), signers: [signer(1, 'admin', 'Jaasiel Nascimento Lima', 'signed'), signer(2, 'coord', 'Francisco Gilson Rebouças Porto Junior', 'pending')] });
    await dispatchAfterSignature('req');
    const [instance, , file, number, caption] = mocks.send.mock.calls[0];
    expect(instance).toBe('Gesproject-admin');
    expect(file.filename).toBe('formulario-26-jaasiel.pdf');
    expect(number).toBe('5563984028033');
    expect(caption).toContain('Olá, Francisco!');
    expect(caption).toContain('Já assinado por *Jaasiel Nascimento Lima*');
    expect(caption).toContain('✅ 1. Jaasiel Nascimento Lima — Beneficiário');
    expect(caption).toContain('✍️ 2. Francisco Gilson Rebouças Porto Junior — Coordenação');
    expect(caption).toContain('*aguardando você*');
    expect(caption).toContain('https://app.example/assinar/req');
    expect(caption).toContain('senha temporária');
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it('sends the beneficiary the document and the stages as soon as the request opens', async () => {
    mocks.load.mockResolvedValue({ request: { ...request('pending'), created_by: 'coord' }, signers: [signer(1, 'admin', 'Jaasiel Nascimento Lima', 'pending'), signer(2, 'coord', 'Francisco Gilson Rebouças Porto Junior', 'waiting')] });
    mocks.own.mockResolvedValue({ instance: 'Gesproject-coord', token: 'k' });
    await dispatchAfterSignature('req');
    const [instance, , , number, caption] = mocks.send.mock.calls[0];
    expect(instance).toBe('Gesproject-coord');
    expect(number).toBe('5563984031162');
    expect(caption).toContain('✍️ *ASSINATURA ELETRÔNICA*');
    expect(caption).toContain('Olá, Jaasiel!');
    expect(caption).toContain('✍️ 1. Jaasiel Nascimento Lima — Beneficiário');
    expect(caption).toContain('⏳ 2. Francisco Gilson Rebouças Porto Junior — Coordenação');
    expect(caption).toContain('⏳ 3. PDF assinado enviado à administração');
  });
  it('does not message whoever opened the request when it is their own turn', async () => {
    mocks.load.mockResolvedValue({ request: request('pending'), signers: [signer(1, 'admin', 'Jaasiel Nascimento Lima', 'pending'), signer(2, 'coord', 'Francisco', 'waiting')] });
    await dispatchAfterSignature('req');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('archives the signed PDF and sends it to whoever opened the request', async () => {
    mocks.load.mockResolvedValue({ request: request('completed'), signers: [signer(1, 'admin', 'Jaasiel Nascimento Lima', 'signed'), signer(2, 'coord', 'Francisco Gilson Rebouças Porto Junior', 'signed')] });
    await dispatchAfterSignature('req');
    expect(mocks.put).toHaveBeenCalledWith('project/admin/signed/req.pdf', Buffer.from('%PDF signed'), 'application/pdf');
    expect(mocks.query.mock.calls.some(([s]) => /INSERT INTO documents/.test(s.join('?')))).toBe(true);
    const [, , file, number, caption] = mocks.send.mock.calls[0];
    expect(number).toBe('5563984031162');
    expect(file.filename).toBe('formulario-26-jaasiel-assinado.pdf');
    expect(caption).toContain('ASSINADO POR TODOS');
    expect(caption).toContain('✅ 3. PDF assinado enviado à administração');
    expect(caption).toContain('ABCD-1234-EF56');
    expect(caption).toContain('prestação de contas no sistema da FAPTO');
  });
  it('keeps the archive and records why nothing was sent when WhatsApp is offline', async () => {
    mocks.state.mockResolvedValue('close');
    mocks.load.mockResolvedValue({ request: request('completed'), signers: [signer(1, 'admin', 'Jaasiel', 'signed')] });
    await dispatchAfterSignature('req');
    expect(mocks.put).toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.some(([s, , , action]) => /audit_logs/.test(s.join('?')) && action === 'dispatch_skipped')).toBe(true);
  });
});
