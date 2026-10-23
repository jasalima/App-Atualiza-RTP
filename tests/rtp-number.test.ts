import { describe, expect, it } from 'vitest';
import { nextRtpNumber, rtpYear } from '../lib/rtp-number';

describe('numeração global do RTP', () => {
  it('começa em 01 no ano sem relatórios', () => {
    expect(nextRtpNumber([], '2026')).toBe('01/2026');
  });
  it('continua a sequência do projeto, independentemente do bolsista', () => {
    expect(nextRtpNumber(['01/2026'], '2026')).toBe('02/2026');
    expect(nextRtpNumber(['01/2026', '02/2026', '03/2026'], '2026')).toBe('04/2026');
  });
  it('não preenche lacunas deixadas por relatórios excluídos', () => {
    expect(nextRtpNumber(['01/2026', '03/2026'], '2026')).toBe('04/2026');
  });
  it('reinicia a cada ano e ignora formatos fora do padrão', () => {
    expect(nextRtpNumber(['07/2026', 'teste'], '2027')).toBe('01/2027');
    expect(rtpYear('2027-01-15')).toBe('2027');
  });
  it('passa de 99 sem perder a ordem', () => {
    expect(nextRtpNumber(['99/2026'], '2026')).toBe('100/2026');
  });
});
