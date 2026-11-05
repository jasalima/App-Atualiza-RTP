// Meeting minutes (atas de reunião): types and pure rules shared by the editor, the PDF and
// the server. Rich text is stored as Tiptap/ProseMirror JSON.

export type RichMark = { type: string; attrs?: Record<string, unknown> };
export type RichNode = { type: string; attrs?: Record<string, any>; content?: RichNode[]; text?: string; marks?: RichMark[] };
export type RichDoc = { type: 'doc'; content: RichNode[] };

export type Attendance = 'present' | 'absent' | 'justified' | 'guest';
export type Modality = 'online' | 'presencial' | 'hibrida';
export type MinuteParticipant = { scholarId: string | null; authUserId: string | null; name: string; institution: string; role: string; email: string; cpf?: string; phone?: string; attendance: Attendance; signs: boolean };
export type MinuteTopic = { id: string; title: string; body: RichDoc; children: MinuteTopic[] };
export type MinuteHeader = { lines: string[]; address: string; footer: string };
export type MinuteAttachment = { key: string; name: string; mime: string; size: number; caption: string; width?: number; height?: number };
export type NextMeeting = { date: string | null; time: string | null; notes: string };

/** What the editor saves. */
export type MinuteDraft = {
  title: string; subject: string; meetingDate: string | null; startsAt: string | null; endsAt: string | null;
  modality: Modality; location: string; platform: string; chairedBy: string; draftedBy: string; objective: string; place: string;
  header: MinuteHeader; intro: RichDoc | null; topics: MinuteTopic[]; decisions: RichDoc | null; nextMeeting: NextMeeting; closing: RichDoc | null;
  attachments: MinuteAttachment[]; participants: MinuteParticipant[];
};

/** What is frozen, signed and printed: automatic paragraphs resolved, no e-mails. */
export type MinuteContent = Omit<MinuteDraft, 'intro' | 'closing' | 'participants' | 'decisions'> & {
  number: string; projectTitle: string; intro: RichDoc; closing: RichDoc; decisions: RichDoc;
  participants: Array<Omit<MinuteParticipant, 'email' | 'scholarId' | 'cpf' | 'phone'>>;
};

export type MinuteStatus = 'draft' | 'editing' | 'finalized' | 'archived' | 'cancelled';
export type MinuteDisplayStatus = 'draft' | 'editing' | 'finalized' | 'awaiting' | 'partial' | 'signed' | 'archived' | 'cancelled';
export const STATUS_LABEL: Record<MinuteDisplayStatus, string> = {
  draft: 'Rascunho', editing: 'Em elaboração', finalized: 'Finalizada', awaiting: 'Aguardando assinaturas',
  partial: 'Parcialmente assinada', signed: 'Totalmente assinada', archived: 'Arquivada', cancelled: 'Cancelada'
};
export const ATTENDANCE_LABEL: Record<Attendance, string> = { present: 'Presente', absent: 'Ausente', justified: 'Ausência justificada', guest: 'Convidado externo' };

/** Situation shown to people: the stored status plus the progress of the signatures. */
export function displayStatus(status: MinuteStatus, request: { status: string; signed: number; total: number } | null): MinuteDisplayStatus {
  if (status !== 'finalized') return status;
  if (!request || !['pending', 'completed'].includes(request.status)) return 'finalized';
  if (request.status === 'completed' || (request.total > 0 && request.signed >= request.total)) return 'signed';
  return request.signed > 0 ? 'partial' : 'awaiting';
}

export const minuteNumber = (seq: number, year: number) => `ATA Nº ${String(seq).padStart(3, '0')}/${year}`;

export const DEFAULT_HEADER: MinuteHeader = {
  lines: ['UNIVERSIDADE FEDERAL DO TOCANTINS – PRÓ-REITORIA DE PESQUISA', 'PLANO DE DESENVOLVIMENTO SUSTENTÁVEL DO POLO DE AGRICULTURA IRRIGADA DO SUDOESTE DO TOCANTINS'],
  address: 'Avenida NS 15, ALCNO 14, Reitoria | CEP 77001-090 | Palmas/TO | (63) 3229-4037 | www.uft.edu.br | propesq@uft.edu.br',
  footer: 'Ata de Reunião — Equipe do Projeto'
};
export const emptyDoc = (): RichDoc => ({ type: 'doc', content: [{ type: 'paragraph' }] });
export function emptyDraft(drafter = ''): MinuteDraft {
  return {
    title: 'ATA DE REUNIÃO – EQUIPE DO PROJETO', subject: '', meetingDate: null, startsAt: null, endsAt: null, modality: 'online', location: '', platform: 'Google Meet',
    chairedBy: '', draftedBy: drafter, objective: '', place: 'Palmas, TO', header: DEFAULT_HEADER, intro: null,
    topics: [], decisions: null, nextMeeting: { date: null, time: null, notes: '' }, closing: null, attachments: [], participants: []
  };
}

/* Numbers and dates written out, as in the minutes ("10h05min (dez horas e cinco minutos)") -- */
const UNITS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta'];
/** 0–59 in words; feminine for "horas" (uma, duas). */
export function inWords(n: number, feminine = false): string {
  const fem = (w: string) => feminine ? w.replace(/^um$/, 'uma').replace(/^dois$/, 'duas') : w;
  if (n < 20) return fem(UNITS[n]);
  const t = Math.floor(n / 10), u = n % 10;
  return u ? `${TENS[t]} e ${fem(UNITS[u])}` : TENS[t];
}
export function timeText(hhmm: string | null) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return '';
  const h = Number(m[1]), min = Number(m[2]);
  const hours = `${inWords(h, true)} ${h === 1 ? 'hora' : 'horas'}`, minutes = `${inWords(min)} ${min === 1 ? 'minuto' : 'minutos'}`;
  return min ? `${String(h).padStart(2, '0')}h${String(min).padStart(2, '0')}min (${hours} e ${minutes})` : `${String(h).padStart(2, '0')}h (${hours})`;
}
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const dateParts = (iso: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ''); return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) } : null; };
/** "04 (quatro) de novembro de 2026". */
export function dateInWords(iso: string | null) {
  const p = dateParts(iso);
  if (!p) return '';
  const day = p.d === 1 ? '1º (primeiro)' : `${String(p.d).padStart(2, '0')} (${p.d < 60 ? inWords(p.d) : p.d})`;
  return `${day} de ${MONTHS[p.mo - 1]} de ${p.y}`;
}
/** "04 de novembro de 2026". */
export function dateLong(iso: string | null) { const p = dateParts(iso); return p ? `${String(p.d).padStart(2, '0')} de ${MONTHS[p.mo - 1]} de ${p.y}` : ''; }
export const dateShort = (iso: string | null) => { const p = dateParts(iso); return p ? `${String(p.d).padStart(2, '0')}/${String(p.mo).padStart(2, '0')}/${p.y}` : ''; };

export function modalityText(d: Pick<MinuteDraft, 'modality' | 'location' | 'platform'>) {
  const platform = d.platform.trim(), location = d.location.trim();
  if (d.modality === 'presencial') return location ? `presencialmente, em ${location}` : 'presencialmente';
  if (d.modality === 'hibrida') return `de forma híbrida${location ? `, presencialmente em ${location}` : ''} e por videoconferência${platform ? ` (${platform})` : ''}`;
  return `de forma on-line, por videoconferência${platform ? ` (${platform})` : ''}`;
}

const text = (t: string, bold = false): RichNode => (bold ? { type: 'text', text: t, marks: [{ type: 'bold' }] } : { type: 'text', text: t });
const paragraph = (content: RichNode[]): RichNode => ({ type: 'paragraph', attrs: { textAlign: 'justify' }, content: content.filter((n) => n.text) });
/** Names joined as in Portuguese: "A, B e C". */
export function joinNames(names: string[]) { return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`; }
export const attendees = (d: Pick<MinuteDraft, 'participants'>) => d.participants.filter((p) => p.attendance === 'present' || p.attendance === 'guest');

/** Opening paragraph written from the identification fields (editable afterwards). */
export function autoIntro(d: MinuteDraft, projectTitle: string): RichDoc {
  const names = attendees(d).map((p) => p.name.trim().toLocaleUpperCase('pt-BR')).filter(Boolean);
  const nodes: RichNode[] = [];
  const at = timeText(d.startsAt), day = dateInWords(d.meetingDate);
  if (at) nodes.push(text('Às '), text(at, true), text(' do dia '));
  else nodes.push(text('No dia '));
  nodes.push(text(day || '___ de ________ de ____', true), text(`, ${modalityText(d)}, realizou-se reunião da equipe do Projeto `), text(projectTitle, true));
  if (names.length) { nodes.push(text(', com a participação de: ')); names.forEach((n, i) => { nodes.push(text(n, true)); if (i < names.length - 2) nodes.push(text(', ')); else if (i === names.length - 2) nodes.push(text(' e ')); }); }
  nodes.push(text('.'));
  if (d.objective.trim()) nodes.push(text(` Objetivo da reunião: ${d.objective.trim().replace(/\.$/, '')}.`));
  nodes.push(text(' Dando início aos trabalhos, foram tratados os seguintes pontos de pauta:'));
  return { type: 'doc', content: [paragraph(nodes)] };
}
/** Closing paragraph with the end time and who drafted the minutes. */
export function autoClosing(d: MinuteDraft): RichDoc {
  const end = timeText(d.endsAt), who = d.draftedBy.trim();
  const nodes: RichNode[] = [text(`Não havendo mais nada a tratar, a reunião foi encerrada${end ? ` às ${end}` : ''}`)];
  if (who) nodes.push(text(' e eu, '), text(who, true), text(', lavrei a presente ata que segue assinada pelos participantes.'));
  else nodes.push(text(', sendo lavrada a presente ata, que segue assinada pelos participantes.'));
  if (d.attachments.some((a) => a.mime.startsWith('image/'))) nodes.push(text(' Integra esta ata, como prova documental, o registro fotográfico constante do Anexo I.'));
  return { type: 'doc', content: [paragraph(nodes)] };
}

/** Plain text of rich content (search, emptiness). */
export function docText(node: RichNode | RichDoc | null | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return (node as RichNode).text ?? '';
  return (node.content ?? []).map(docText).join(node.type === 'doc' ? '\n' : node.type === 'paragraph' || node.type === 'heading' ? '' : ' ').trim();
}
export const isEmptyDoc = (doc: RichDoc | null | undefined) => !doc || (!docText(doc).trim() && !JSON.stringify(doc).includes('"image"') && !JSON.stringify(doc).includes('"table"'));

/** "1", "1.1"… for topics and subtopics in order. */
export function numberTopics(topics: MinuteTopic[]) {
  return topics.map((t, i) => ({ topic: t, number: `${i + 1}`, children: t.children.map((c, j) => ({ topic: c, number: `${i + 1}.${j + 1}` })) }));
}

/** Freezes the draft as it will be printed and signed. */
export function freezeContent(d: MinuteDraft, meta: { number: string; projectTitle: string }): MinuteContent {
  const { participants, intro, closing, decisions, ...rest } = d;
  return {
    ...rest, number: meta.number, projectTitle: meta.projectTitle,
    intro: intro && !isEmptyDoc(intro) ? intro : autoIntro(d, meta.projectTitle),
    closing: closing && !isEmptyDoc(closing) ? closing : autoClosing(d),
    decisions: decisions ?? { type: 'doc', content: [] },
    participants: participants.map(({ email: _e, scholarId: _s, cpf: _cpf, phone: _phone, ...p }) => p)
  };
}
