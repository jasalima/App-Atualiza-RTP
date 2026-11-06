import { describe, expect, it } from 'vitest';
import { form26Signer, isCoordination } from '../lib/travel-signers';

const ben = { step: 1, name: 'Ana' }, coord = { step: 2, name: 'Bruno' };

describe('Form 26 signature lines', () => {
  it('uses each signer on their own line', () => {
    expect(form26Signer([ben, coord], 1, true)).toBe(ben);
    expect(form26Signer([ben, coord], 2, true)).toBe(coord);
  });
  it('fills the "De acordo" line with the coordinator who is the beneficiary, once completed', () => {
    expect(form26Signer([ben], 2, true)).toBe(ben);
  });
  it('leaves the "De acordo" line blank while the coordination has not signed', () => {
    expect(form26Signer([ben], 2, false)).toBeUndefined();
  });
  it('recognises the coordination by role or function', () => {
    expect(isCoordination({ role: 'coordinator', roleLabel: 'Pesquisador' })).toBe(true);
    expect(isCoordination({ role: 'scholar', roleLabel: 'Coordenador do projeto' })).toBe(true);
    expect(isCoordination({ role: 'signer', roleLabel: 'Bolsista' })).toBe(false);
  });
});
