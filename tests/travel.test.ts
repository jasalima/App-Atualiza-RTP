import { afterEach, describe, expect, it, vi } from 'vitest';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { travelDocx, travelPdf, type TravelBeneficiary } from '../server/services/travel-export';
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
      for (const value of Object.values(b)) expect(text).toContain(value);
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
