import { describe, expect, it, vi } from 'vitest';
import { Evolution, EvolutionError, providerDetail, waNumber, waVariants } from '../server/services/evolution';

const sent = { key: { id: 'MSG1' } };
const bad = (body: unknown) => Response.json(body, { status: 400 });
const make = (...responses: Response[]) => {
  const fetcher = vi.fn<typeof fetch>();
  for (const r of responses) fetcher.mockResolvedValueOnce(r);
  return { fetcher, evo: new Evolution('https://evolution.example', 'master', fetcher, async () => {}) };
};
const paths = (f: ReturnType<typeof make>['fetcher']) => f.mock.calls.map(([u]) => new URL(String(u)).pathname);
const bodyOf = (f: ReturnType<typeof make>['fetcher'], i: number) => JSON.parse(String(f.mock.calls[i][1]!.body));

describe('WhatsApp numbers', () => {
  it('normalises and offers both Brazilian mobile forms', () => {
    expect(waNumber('(63) 98402-8033')).toBe('5563984028033');
    expect(waNumber('+55 63 98402-8033')).toBe('5563984028033');
    expect(waVariants('5563984028033')).toEqual(['5563984028033', '556384028033']);
    expect(waVariants('556384028033')).toEqual(['556384028033', '5563984028033']);
    expect(waVariants('556332148033')).toEqual(['556332148033']); // landline
    expect(waVariants('14155550100')).toEqual(['14155550100']);
  });
  it('keeps the provider reason without phone numbers', () => {
    expect(providerDetail({ status: 400, error: 'Bad Request', response: { message: ['Error: Connection Closed'] } })).toBe('Error: Connection Closed');
    expect(providerDetail({ response: { message: [{ jid: '5563984028033@s.whatsapp.net', exists: false, number: '5563984028033' }] } })).toBe('NUMBER_NOT_ON_WHATSAPP');
    expect(providerDetail({ message: 'falha para 5563984028033@s.whatsapp.net' })).toBe('falha para •••');
  });
});

describe('Resilient delivery', () => {
  it('retries a session hiccup and succeeds without bothering the user', async () => {
    const { fetcher, evo } = make(bad({ response: { message: ['Error: Connection Closed'] } }), Response.json(sent));
    expect(await evo.sendText('inst', 'tok', '(63) 98402-8033', 'oi')).toEqual({ messageId: 'MSG1' });
    expect(paths(fetcher)).toEqual(['/message/sendText/inst', '/message/sendText/inst']);
    expect(bodyOf(fetcher, 0).number).toBe('5563984028033');
  });
  it('switches to the form of the number WhatsApp knows', async () => {
    const { fetcher, evo } = make(
      bad({ response: { message: [{ exists: false, jid: '556384028033@s.whatsapp.net', number: '5563984028033' }] } }),
      Response.json([{ exists: false, number: '5563984028033' }, { exists: true, jid: '556384028033@s.whatsapp.net', number: '556384028033' }]),
      Response.json(sent));
    expect(await evo.sendText('inst', 'tok', '5563984028033', 'oi')).toEqual({ messageId: 'MSG1' });
    expect(paths(fetcher)[1]).toBe('/chat/whatsappNumbers/inst');
    expect(bodyOf(fetcher, 2).number).toBe('556384028033');
  });
  it('explains a number without WhatsApp instead of a bare status code', async () => {
    const { evo } = make(bad({ response: { message: [{ exists: false }] } }), Response.json([{ exists: false }, { exists: false }]));
    await expect(evo.sendText('inst', 'tok', '5563984028033', 'oi')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('não tem WhatsApp ativo') });
  });
  it('after three refusals reports a disconnected sender', async () => {
    const closed = () => bad({ response: { message: ['Connection Closed'] } });
    const { fetcher, evo } = make(closed(), closed(), closed(), Response.json({ instance: { state: 'close' } }));
    await expect(evo.sendText('inst', 'tok', '5563984028033', 'oi')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('desconectado') });
    expect(paths(fetcher).filter((p) => p.startsWith('/message/'))).toHaveLength(3);
  });
  it('after three refusals with the session open, gives the provider reason', async () => {
    const closed = () => bad({ response: { message: ['Timed Out'] } });
    const { evo } = make(closed(), closed(), closed(), Response.json({ instance: { state: 'open' } }));
    const error = await evo.sendText('inst', 'tok', '5563984028033', 'oi').catch((e) => e);
    expect(error).toBeInstanceOf(EvolutionError);
    expect(error.message).toContain('Timed Out');
    expect(error.message).not.toContain('5563984028033');
  });
  it('never resends when the outcome is unknown (timeout, unconfirmed id)', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('timeout'));
    await expect(new Evolution('https://evolution.example', 'm', fetcher, async () => {}).sendText('inst', 'tok', '5563984028033', 'oi')).rejects.toThrow('indisponível');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const { fetcher: f2, evo } = make(Response.json({ key: {} }));
    await expect(evo.sendText('inst', 'tok', '5563984028033', 'oi')).rejects.toThrow('identificador');
    expect(f2).toHaveBeenCalledTimes(1);
  });
  it('maps a rejected instance key to a reconnect instruction', async () => {
    const { evo } = make(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    await expect(evo.sendText('inst', 'tok', '5563984028033', 'oi')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Reconectar') });
  });
});
