import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/db', () => ({ sql: vi.fn() }));
vi.mock('../lib/signatures', () => ({ signLink: (id: string) => `https://app.example/assinar/${id}` }));
vi.mock('../lib/storage', () => ({ putPrivateObject: vi.fn(), readPrivateObject: vi.fn() }));
import pdf from 'pdf-parse';
import { autoClosing, autoIntro, dateInWords, displayStatus, docText, freezeContent, minuteNumber, numberTopics, timeText } from '../lib/minutes-model';
import { newPublicCode, normalizePublicCode, PUBLIC_CODE_PATTERN, versionHash } from '../lib/minutes-core';
import { minutesPdf, pdfSafe, signatureId } from '../server/services/minutes-pdf';
import { stagesText, signatureMessage } from '../lib/signature-view';
import { fakeSignature, PEOPLE, PROJECT, sampleContent, sampleDraft } from './fixtures/minute-sample';

describe('textos automáticos da ata', () => {
  it('escreve horários e datas por extenso como no modelo', () => {
    expect(timeText('10:05')).toBe('10h05min (dez horas e cinco minutos)');
    expect(timeText('10:39')).toBe('10h39min (dez horas e trinta e nove minutos)');
    expect(timeText('01:01')).toBe('01h01min (uma hora e um minuto)');
    expect(timeText('22:00')).toBe('22h (vinte e duas horas)');
    expect(dateInWords('2026-11-04')).toBe('04 (quatro) de novembro de 2026');
    expect(dateInWords('2026-03-01')).toBe('1º (primeiro) de março de 2026');
  });
  it('monta a abertura com os presentes em negrito e sem os ausentes', () => {
    const intro = autoIntro(sampleDraft(), PROJECT), text = docText(intro);
    expect(text).toMatch(/^Às 10h05min \(dez horas e cinco minutos\) do dia 04 \(quatro\) de novembro de 2026, de forma on-line, por videoconferência \(Google Meet\)/);
    expect(text).toContain('com a participação de: NILSON DENUNCIO, MAXWELL DIÓGENES BANDEIRA DE MELO, ADRIAN DA SILVA, ANDERSON SACRAMENTO e GUSTAVO CONSALES.');
    expect(text).not.toContain('ELAINE');
    const bold = intro.content[0].content!.filter((n) => n.marks?.some((m) => m.type === 'bold')).map((n) => n.text);
    expect(bold).toEqual(expect.arrayContaining(['10h05min (dez horas e cinco minutos)', PROJECT, 'GUSTAVO CONSALES']));
  });
  it('fecha com o horário de encerramento e quem lavrou a ata', () => {
    const d = sampleDraft();
    expect(docText(autoClosing(d))).toBe('Não havendo mais nada a tratar, a reunião foi encerrada às 10h39min (dez horas e trinta e nove minutos) e eu, Nilson Denuncio, lavrei a presente ata que segue assinada pelos participantes.');
    d.attachments = [{ key: 'k', name: 'print.jpg', mime: 'image/jpeg', size: 1, caption: '' }];
    expect(docText(autoClosing(d))).toContain('registro fotográfico constante do Anexo I');
  });
  it('numera tópicos e subtópicos automaticamente', () => {
    expect(numberTopics(sampleDraft().topics).map((t) => [t.number, ...t.children.map((c) => c.number)])).toEqual([['1'], ['2', '2.1'], ['3']]);
    expect(minuteNumber(1, 2026)).toBe('ATA Nº 001/2026');
  });
  it('congela o conteúdo sem e-mails e preserva textos editados manualmente', () => {
    const d = sampleDraft(); d.participants[0].email = 'nilson@uft.edu.br';
    d.closing = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Encerramento escrito à mão.' }] }] };
    const c = freezeContent(d, { number: 'ATA Nº 001/2026', projectTitle: PROJECT });
    expect(JSON.stringify(c)).not.toContain('nilson@uft.edu.br');
    expect(docText(c.closing)).toBe('Encerramento escrito à mão.');
    expect(docText(c.intro)).toContain('Objetivo da reunião');
  });
  it('deriva as situações da ata a partir das assinaturas', () => {
    expect(displayStatus('editing', null)).toBe('editing');
    expect(displayStatus('finalized', null)).toBe('finalized');
    expect(displayStatus('finalized', { status: 'pending', signed: 0, total: 5 })).toBe('awaiting');
    expect(displayStatus('finalized', { status: 'pending', signed: 3, total: 5 })).toBe('partial');
    expect(displayStatus('finalized', { status: 'completed', signed: 5, total: 5 })).toBe('signed');
    expect(displayStatus('finalized', { status: 'cancelled', signed: 2, total: 5 })).toBe('finalized');
    expect(displayStatus('cancelled', { status: 'completed', signed: 5, total: 5 })).toBe('cancelled');
  });
});

describe('código público e hash', () => {
  it('gera códigos de 16 caracteres sem 0/O/1/I e aceita digitação livre', () => {
    const codes = new Set(Array.from({ length: 200 }, () => newPublicCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(new RegExp(`^${PUBLIC_CODE_PATTERN.source}$`));
    const c = [...codes][0];
    expect(normalizePublicCode(c.toLowerCase().replace(/-/g, ' '))).toBe(c);
    expect(normalizePublicCode('ABCD-EFGH-IJKL-MNOP')).toBeNull(); // I and O are not in the alphabet
  });
  it('o hash da versão muda com qualquer alteração do conteúdo e não depende da ordem das chaves', () => {
    const c = sampleContent(), h = versionHash('v1', c);
    expect(versionHash('v1', JSON.parse(JSON.stringify(c)))).toBe(h);
    expect(versionHash('v1', { ...c, subject: `${c.subject}.` })).not.toBe(h);
    expect(versionHash('v2', c)).not.toBe(h);
  });
});

describe('PDF da ata', () => {
  const base = { draft: false, version: 1, code: 'K7QM-2XRP-9TFA-H3WD', verifyUrl: 'https://atualizaprojeto.vercel.app/verificar-documento/K7QM-2XRP-9TFA-H3WD', contentHash: 'a'.repeat(64), issuedAt: '2026-11-04T14:00:00Z', totalSigners: 5, images: new Map(), createdAt: new Date('2026-11-05T12:00:00Z') };
  const sigs = PEOPLE.map((name, i) => fakeSignature(name, 'Produto 1.3 / UFT', `2026-11-0${4 + (i % 2)}T1${i}:00:00Z`));
  const text = async (b: Buffer) => (await pdf(b)).text.replace(/\s+/g, ' ');

  it('D — com 3 de 5 assinaturas mostra apenas as concluídas', async () => {
    const t = await text(await minutesPdf(sampleContent(), { ...base, signatures: [sigs[3], sigs[1], sigs[4]] }));
    expect(t.match(/Assinado eletronicamente por/g)).toHaveLength(3);
    expect(t).toContain('ANDERSON SACRAMENTO');
    expect(t).not.toContain('por NILSON DENUNCIO');
    expect(t).toContain('3 de 5 assinaturas concluídas');
    expect(t).toContain('IP 200.129.163.10');
    expect(t).toContain('Fundamentação legal');
    expect(t).toContain('K7QM-2XRP-9TFA-H3WD');
  });
  it('E — com todas as assinaturas traz os cinco blocos, o QR e o código; o mesmo estado gera o mesmo arquivo', async () => {
    const a = await minutesPdf(sampleContent(), { ...base, signatures: sigs }), b = await minutesPdf(sampleContent(), { ...base, signatures: sigs });
    expect(a.equals(b)).toBe(true);
    const t = await text(a);
    expect(t.match(/Assinado eletronicamente por/g)).toHaveLength(5);
    expect(t).not.toContain('assinaturas concluídas');
    expect(t).toContain('AUTENTICIDADE DO DOCUMENTO');
    expect(t).toContain(signatureId(sigs[0].signatureHash));
    expect(t).toMatch(/ATA DE REUNIÃO – EQUIPE DO PROJETO.*DECISÕES E ENCAMINHAMENTOS.*PRÓXIMA REUNIÃO.*LISTA DE PRESENÇA.*ASSINATURAS ELETRÔNICAS.*AUTENTICIDADE DO DOCUMENTO/);
    expect(t).not.toMatch(/\bsei\b|SEI!/i);
  });
  it('minuta: marca d’água e nenhuma declaração de assinatura', async () => {
    const t = await text(await minutesPdf(sampleContent(), { draft: true, signatures: [], totalSigners: 0, images: new Map() }));
    expect(t).toContain('MINUTA');
    expect(t).not.toContain('Assinado eletronicamente por');
    expect(t).toContain('gerados quando a ata é finalizada');
  });
  it('anexos vêm depois das assinaturas', async () => {
    const c = sampleContent(); c.attachments = [{ key: 'x', name: 'lista.pdf', mime: 'application/pdf', size: 20480, caption: 'Lista assinada' }];
    const t = await text(await minutesPdf(c, { ...base, signatures: sigs }));
    expect(t.indexOf('ANEXO I – DOCUMENTOS COMPLEMENTARES')).toBeGreaterThan(t.indexOf('AUTENTICIDADE DO DOCUMENTO'));
  });
  it('troca símbolos fora das fontes padrão do PDF', () => {
    expect(pdfSafe('a → b ≥ c 😀 “ok” – fim')).toBe('a -> b >= c  “ok” – fim');
  });
});

describe('mensagens das atas', () => {
  const signers = [{ step: 1, name: 'Nilson Denuncio', status: 'signed', signed_at: '2026-11-04T17:35:00Z', role_label: 'Equipe do Projeto / UFT' }, { step: 2, name: 'Adrian da Silva', status: 'pending', signed_at: null, role_label: 'APROEST' }, { step: 3, name: 'Gustavo Consales', status: 'pending', signed_at: null }];
  it('mostra as assinaturas simultâneas, sem fila', () => {
    const t = stagesText(signers, { completed: false, currentStep: 2, parallel: true });
    expect(t).toContain('📋 *Assinaturas da ata* (simultâneas, em qualquer ordem)');
    expect(t).toContain('✅ 1. Nilson Denuncio — Equipe do Projeto / UFT');
    expect(t).toContain('✍️ 2. Adrian da Silva — APROEST\n      *aguardando você*');
    expect(t).toContain('⏳ 3. Gustavo Consales\n      _pendente_');
    expect(t).not.toContain('na fila');
    expect(t).toContain('⏳ Ata assinada por todos');
  });
  it('mantém o texto das assinaturas em ordem (viagem/RTP) sem mudança', () => {
    const t = stagesText(signers.slice(0, 2), { completed: false, currentStep: 2 });
    expect(t).toContain('✍️ 2. Adrian da Silva — Coordenação');
    expect(t).toContain('⏳ 3. PDF assinado enviado à administração');
  });
  it('convida para assinar em qualquer ordem', () => {
    const m = signatureMessage({ name: 'Adrian da Silva', label: 'ATA Nº 001/2026 — Alinhamento', link: 'https://x/assinar/1', firstAccess: false, from: { name: 'Jaasiel', role: 'Assistente' }, signers, currentStep: 2, parallel: true });
    expect(m).toContain('podem assinar em qualquer ordem (já assinaram: Nilson Denuncio)');
  });
});
