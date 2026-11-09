import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rows: vi.fn(), report: vi.fn(), read: vi.fn() }));
vi.mock('../lib/db', () => ({ sql: (s: TemplateStringsArray, ...v: unknown[]) => m.rows(s.join('?'), v) }));
vi.mock('../lib/storage', () => ({ readPrivateObject: m.read }));
vi.mock('../lib/signatures', () => ({
  verifyLink: (c: string) => `https://app.example/verificar/${c}`, fullTravelFill: async (r: { departureDate: string }) => ({ departure: r.departureDate, signatures: { status: 'completed', signers: [] } }),
  signerCandidates: async () => [{ authUserId: 'coord', name: 'Jaasiel Lima', roleLabel: 'Coordenação geral' }]
}));
vi.mock('../lib/travel', () => ({
  travelReportById: m.report, beneficiaryOf: async () => ({ name: 'Francisco Gilson Pôrto', role: 'Bolsista', phone: '', email: '', project: 'P' }),
  travelFile: async () => ({ buffer: Buffer.from('%PDF fresh') }),
  travelFileName: (n: string) => `PCDP_${n.replace(/\s+/g, '_')}_22-09-2026_assinado.pdf`
}));
import { render, sendTravelToFapto, toHtml } from '../lib/fapto-email';
import { EmailError, sendEmail } from '../server/services/resend';

const user = { id: 'coord', email: 'coord@uft.edu.br', name: 'Jaasiel' };
const input = (o: Record<string, unknown> = {}) => ({ projectId: '11111111-1111-4111-8111-111111111111', reportIds: ['22222222-2222-4222-8222-222222222222'], preview: false, ...o });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 're_test'); vi.stubEnv('EMAIL_FROM', 'RTP <rtp@exemplo.org>');
  m.report.mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222', scholarId: 's', scholarName: 'Gilson', destination: 'Lagoa da Confusão/TO', departureDate: '2026-09-22', returnDate: '2026-09-22' });
  m.read.mockResolvedValue(Buffer.from('%PDF archived'));
  m.rows.mockImplementation((q: string) => Promise.resolve(
    q.includes('FROM project_email_settings') ? [{ recipients: ['analista@fapto.org.br'], cc: [], subject_template: 'PCDP {{beneficiarios}}', body_template: 'Olá\n\n{{relatorios}}\n\n{{remetente}} — {{funcao_remetente}}' }]
    : q.includes('FROM signature_requests') ? [{ source_id: '22222222-2222-4222-8222-222222222222', status: 'completed', verification_code: 'ABCD-1234', archived_document_id: '33333333-3333-4333-8333-333333333333' }]
    : q.includes('FROM projects') ? [{ title: 'Projeto', agreement: '7886-6 Convênio' }]
    : q.includes('FROM documents') ? [{ storage_key: 'p/signed.pdf' }]
    : q.includes('max(created_at)') ? [{ at: null }]
    : q.includes('INSERT INTO email_deliveries') ? [{ id: 'd-1' }] : []));
  fetchMock = vi.fn(async () => Response.json({ id: 're-123' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('modelo de e-mail', () => {
  it('preenche os campos e mantém os desconhecidos', () => {
    expect(render('{{projeto}} / {{ beneficiarios }} / {{outro}}', { projeto: 'P', beneficiarios: 'B' })).toBe('P / B / {{outro}}');
  });
  it('gera HTML seguro com links clicáveis', () => {
    const html = toHtml('Olá <b>\n\nVeja https://app.example/verificar/X');
    expect(html).toContain('Olá &lt;b&gt;');
    expect(html).toContain('<a href="https://app.example/verificar/X">');
  });
});

describe('envio à FAPTO', () => {
  it('envia o PDF assinado arquivado, com resposta para quem enviou, e registra', async () => {
    const r = await sendTravelToFapto(input(), user);
    expect(r).toMatchObject({ sent: true, to: ['analista@fapto.org.br'] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('fapto-travel/d-1');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: 'RTP <rtp@exemplo.org>', to: ['analista@fapto.org.br'], reply_to: 'coord@uft.edu.br', subject: 'PCDP Francisco Gilson Pôrto' });
    expect(body.text).toContain('Verificação: https://app.example/verificar/ABCD-1234');
    expect(body.text).toContain('Jaasiel Lima — Coordenação geral');
    expect(body.attachments).toEqual([{ filename: 'PCDP_Francisco_Gilson_Pôrto_22-09-2026_assinado.pdf', content: Buffer.from('%PDF archived').toString('base64') }]);
    expect(m.rows.mock.calls.some(([q]) => q.includes("SET status='sent'"))).toBe(true);
  });
  it('recusa relatório ainda não assinado por todos', async () => {
    m.rows.mockImplementation((q: string) => Promise.resolve(q.includes('FROM signature_requests') ? [{ source_id: '22222222-2222-4222-8222-222222222222', status: 'pending' }] : []));
    await expect(sendTravelToFapto(input(), user)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('pré-visualiza sem enviar', async () => {
    const p = await sendTravelToFapto(input({ preview: true }), user);
    expect(p).toMatchObject({ preview: true, ready: true, subject: 'PCDP Francisco Gilson Pôrto' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('marca a entrega como falha quando o Resend recusa o remetente', async () => {
    fetchMock.mockResolvedValue(Response.json({ message: 'domain not verified' }, { status: 403 }));
    await expect(sendTravelToFapto(input(), user)).rejects.toBeInstanceOf(EmailError);
    expect(m.rows.mock.calls.some(([q]) => q.includes("SET status='failed'"))).toBe(true);
  });
});

describe('Resend', () => {
  it('exige a chave configurada', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    await expect(sendEmail({ from: 'a@b.c', to: ['x@y.z'], subject: 's', text: 't', html: 'h' }, 'k')).rejects.toMatchObject({ status: 409 });
  });
});
