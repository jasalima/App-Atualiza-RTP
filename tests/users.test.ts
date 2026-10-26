import { describe, expect, it } from 'vitest';
import { temporaryPassword } from '../lib/users';

describe('credenciais temporárias', () => {
  it('gera uma senha forte sem caracteres visualmente ambíguos', () => {
    const password=temporaryPassword();
    expect(password).toHaveLength(18);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
    expect(password).not.toMatch(/[01IlO]/);
  });

  it('recusa comprimentos inseguros', () => {
    expect(()=>temporaryPassword(11)).toThrow(/12 caracteres/);
  });
});
