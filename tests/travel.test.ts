import { afterEach, describe, expect, it, vi } from 'vitest';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { formatPhone, travelDocx, travelPdf, type TravelBeneficiary } from '../server/services/travel-export';
import { openCredential, sealCredential } from '../server/services/travel-credentials';

const { access, query } = vi.hoisted(() => ({ access: vi.fn(), query: vi.fn() }));
vi.mock('../lib/authorize', () => ({ requireProject: access }));
vi.mock('../lib/db', () => ({ sql: query }));
import { loadTravel } from '../lib/travel';

const b: TravelBeneficiary = { name: 'Maria de Teste', phone: '5563999990000', email: 'maria@example.com', project: 'Projeto de teste', role: 'Pesquisadora' };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('Formulário 26', () => {
  it('exports beneficiary data with blank travel fields and both signature blocks in each format', async () => {
    const docx = await mammoth.extractRawText({ buffer: await travelDocx(b) });
    const pdf = await pdfParse(await travelPdf(b));
    for (const text of [docx.value, pdf.text]) {
      for (const value of [b.name, b.email, b.project, b.role]) expect(text).toContain(value);
      expect(text).toContain('Contato telefônico: (63) 9 9999-0000');
      expect(text).toContain('Projeto/convênio:');
      expect(text).toContain('FORMULÁRIO 26');
      expect(text).toContain('Cidade/UF origem: ____');
      expect(text).toContain('Cidade/UF destino: ____');
      expect(text).toContain('Saída: ____/____/________');
      expect(text).toContain('Retorno: ____/____/________');
      expect(text).toContain('Assinatura do beneficiário:');
      expect(text).toContain('De acordo (Coordenador do projeto):');
      expect(text).not.toContain('22/09/2026');
      expect(text).not.toContain('FRANCISCO GILSON');
      expect(text).not.toContain('LAGOA DA CONFUSÃO');
    }
    expect(pdf.numpages).toBe(1);
  });
  it('handles long registered names and project titles without losing the signature blocks', async () => {
    const pdf = await pdfParse(await travelPdf({ ...b, name: 'Nome extenso '.repeat(10), project: 'Título institucional extenso '.repeat(12) }));
    expect(pdf.text).toContain('Assinatura do beneficiário:');
    expect(pdf.text).toContain('De acordo (Coordenador do projeto):');
  });
});
describe('formatPhone', () => {
  it('formats Brazilian numbers as (99) 9 9999-9999', () => {
    expect(formatPhone('5563999925840')).toBe('(63) 9 9992-5840');
    expect(formatPhone('63984028033')).toBe('(63) 9 8402-8033');
    expect(formatPhone('+55 (63) 3218-0000')).toBe('(63) 3218-0000');
    expect(formatPhone('')).toBe('');
  });
  it('keeps a filled trip report with several days on a single page', async () => {
    const entries = ['2026-10-21', '2026-10-22', '2026-10-23'].map((date) => ({ date, activity: 'Visita técnica às áreas irrigadas.' }));
    const pdf = await pdfParse(await travelPdf({ ...b, project: 'Título institucional '.repeat(8) }, { origin: 'Palmas/TO', destination: 'Lagoa da Confusão/TO', departure: '2026-10-21', returnDate: '2026-10-23', entries }));
    expect(pdf.numpages).toBe(1);
    expect(pdf.text).toContain('23/10/2026');
  });
});
describe('tenant authorization', () => {
  it('rejects another beneficiary for a scholar before querying member data', async () => {
    access.mockResolvedValueOnce({ role: 'scholar', scholarId: 'own', user: { id: 'u1' } });
    query.mockClear();
    await expect(loadTravel('project', 'other')).rejects.toMatchObject({ status: 403 });
    expect(query).not.toHaveBeenCalled();
  });
  it('requires the member to belong to the authorized project', async () => {
    access.mockResolvedValueOnce({ role: 'coordinator', user: { id: 'u1' } });
    query.mockResolvedValueOnce([]);
    await expect(loadTravel('project-a', 'member-b')).rejects.toMatchObject({ status: 404 });
    const [strings, ...values] = query.mock.calls.at(-1)!;
    expect(strings.join('?')).toContain('s.project_id=');
    expect(values).toContain('project-a');
    expect(values).toContain('member-b');
  });
});
describe('WhatsApp credentials', () => {
  it('encrypts the key and rejects use in another tenant or user scope', () => {
    vi.stubEnv('WHATSAPP_CREDENTIAL_SECRET', 'test-secret-with-more-than-32-characters');
    const encrypted = sealCredential('private-api-key', 'user-a:project-a');
    expect(encrypted).not.toContain('private-api-key');
    expect(openCredential(encrypted, 'user-a:project-a')).toBe('private-api-key');
    expect(() => openCredential(encrypted, 'user-b:project-a')).toThrow();
    expect(() => openCredential(encrypted, 'user-a:project-b')).toThrow();
  });
});
