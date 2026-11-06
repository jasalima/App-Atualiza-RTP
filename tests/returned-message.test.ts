import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/db', () => ({ sql: Object.assign(async () => [], { transaction: async () => [] }) }));
vi.mock('../lib/auth', () => ({ auth: { getSession: async () => ({ data: null }) } }));
import { returnedMessage } from '../lib/signature-view';

describe('documento devolvido ao beneficiário', () => {
  it('names who refused, quotes the reason and explains how to correct and sign again', () => {
    const text = returnedMessage({ name: 'Maria Aparecida Souza', label: 'Relatório de viagem — Lagoa da Confusão/TO', link: 'https://app/assinar/abc', by: 'Carlos Lima', role: 'Coordenador do projeto', reason: 'A data de *retorno* está errada.', firstAccess: false });
    expect(text).toContain('DEVOLVIDO PARA CORREÇÃO');
    expect(text).toContain('Olá, Maria!');
    expect(text).toContain('*Carlos Lima* (Coordenador do projeto) não assinou');
    expect(text).toContain('_A data de retorno está errada._');
    expect(text).toContain('*Alterar ou inserir informações*');
    expect(text).toContain('assine de novo');
    expect(text).toContain('https://app/assinar/abc');
  });
});
