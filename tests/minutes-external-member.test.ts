import { beforeEach, describe, expect, it, vi } from 'vitest';

// An external member (record marked "Externo") without an account signs the ata by the public
// link, with the CPF and WhatsApp of the record; a UFT member without an account still needs one.
const state = vi.hoisted(() => ({ affiliation: 'Externo', cpf: '52998224725', phone: '5563999990000', queries: [] as string[], slots: [] as Array<{ cpf: string; phone: string }> }));
vi.mock('../lib/db', () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join('?'); state.queries.push(q);
    if (q.includes('FROM meeting_minutes m JOIN projects')) return Promise.resolve([{ id: 'm1', project_id: 'p1', status: 'finalized', seq: 3, year: 2026, subject: 'Reunião', title: 'Ata', created_by: 'u1', header: {}, topics: [], next_meeting: {}, attachments: [] }]);
    if (q.includes('FROM meeting_minute_versions')) return Promise.resolve([{ id: 'v1', content_hash: 'h', content: {} }]);
    if (q.includes('FROM meeting_minute_participants WHERE minute_id')) return Promise.resolve([{ scholar_id: 's1', auth_user_id: null, name: 'Maria Externa', institution: 'Externo', role: 'Consultora', email: 'maria@ex.org', attendance: 'present', signs: true }]);
    if (q.includes('SELECT id,full_name,role_area')) return Promise.resolve([{ id: 's1', full_name: 'Maria Externa', role_area: 'Consultora', email: 'maria@ex.org', status: 'active', auth_user_id: null, affiliation: state.affiliation, cpf: state.cpf, phone: state.phone }]);
    if (q.includes('SELECT id,cpf,phone,affiliation FROM scholars')) return Promise.resolve([{ id: 's1', cpf: state.cpf, phone: state.phone, affiliation: state.affiliation }]);
    void values;
    return Promise.resolve([]);
  };
  return { sql: Object.assign(sql, { transaction: async (list: unknown[]) => list.map(() => []) }) };
});
vi.mock('../lib/modules', () => ({ requireModule: async () => ({ role: 'admin', user: { id: 'u1' } }) }));
vi.mock('../lib/signatures', () => ({ signerCandidates: async () => [], clientIp: () => '1.1.1.1' }));
vi.mock('../lib/minutes-core', () => ({ contentImageKeys: () => [], minuteFolder: () => 'f/', minuteVerifyLink: () => '', newPublicCode: () => 'X', versionHash: () => 'h', versionSignatures: async () => ({ request: null, signers: [] }) }));
vi.mock('../lib/storage', () => ({ deletePrivateObjects: vi.fn() }));
vi.mock('../lib/external-signatures', () => ({
  guestPhone: (v: string) => v.replace(/\D/g, ''),
  guestSlot: (_id: string, cpf: string, phone: string) => { state.slots.push({ cpf, phone }); return Promise.resolve([]); }
}));
import { draftInput, participantCandidates, sendForSignature } from '../lib/minutes';

beforeEach(() => { state.affiliation = 'Externo'; state.cpf = '52998224725'; state.phone = '5563999990000'; state.queries = []; state.slots = []; });

describe('external members in the atas', () => {
  it('brings the institution and the public-link readiness from the record', async () => {
    const [c] = await participantCandidates('p1');
    expect(c).toMatchObject({ institution: 'Externo', external: true, guestReady: true, authUserId: null });
    expect(JSON.stringify(c)).not.toContain('52998224725');
  });
  it('sends the external member without account to the public link with the record CPF and WhatsApp', async () => {
    const res = await sendForSignature('m1', new Request('https://app/x'));
    expect(res.signers).toBe(1);
    expect(state.slots).toEqual([{ cpf: '52998224725', phone: '5563999990000' }]);
  });
  it('asks for CPF and WhatsApp in the record when they are missing', async () => {
    state.cpf = '';
    await expect(sendForSignature('m1', new Request('https://app/x'))).rejects.toThrow(/membro externo: informe no cadastro um CPF válido/);
  });
  it('still requires an account from a UFT member', async () => {
    state.affiliation = 'UFT';
    await expect(sendForSignature('m1', new Request('https://app/x'))).rejects.toThrow(/Sem acesso ativo ao projeto: Maria Externa/);
  });
  it('accepts a member without account marked to sign in the draft', () => {
    const p = { scholarId: '5f1c2d3e-0000-4000-8000-000000000001', authUserId: null, name: 'Maria', institution: 'Externo', role: '', email: '', attendance: 'present', signs: true };
    const base = { title: 'Ata', subject: '', meetingDate: null, startsAt: null, endsAt: null, modality: 'online', location: '', platform: '', chairedBy: '', draftedBy: '', objective: '', place: '', header: { lines: [], address: '', footer: '' }, intro: null, topics: [], decisions: null, closing: null, nextMeeting: { date: null, time: null, notes: '' }, attachments: [] };
    expect(draftInput.safeParse({ ...base, participants: [p] }).success).toBe(true);
  });
});
