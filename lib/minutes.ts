import { z } from 'zod';
import { requireModule } from './modules';
import { sql } from './db';
import { clientIp, signerCandidates } from './signatures';
import { normalizeCpf } from './cpf';
import { guestSlot, guestPhone } from './external-signatures';
import { requestView } from './signature-view';
import { contentImageKeys, minuteFolder, minuteVerifyLink, newPublicCode, versionHash, versionSignatures } from './minutes-core';
import { deletePrivateObjects } from './storage';
import { DEFAULT_HEADER, displayStatus, freezeContent, minuteNumber, type MinuteDraft, type MinuteStatus } from './minutes-model';

// Atas de reunião: who may read and change them, the editable draft and its life cycle.
const fail = (message: string, status: number) => Object.assign(new Error(message), { status });
const ymd = (d: unknown) => d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null;
const hm = (t: unknown) => t ? String(t).slice(0, 5) : null;

/** Project members read the project's atas; whoever created one and the coordination change it. */
export async function minuteAccess(id: string, write = false) {
  const [row] = await sql`SELECT m.*,to_char(m.meeting_date,'YYYY-MM-DD') AS meeting_day,p.title AS project_title FROM meeting_minutes m JOIN projects p ON p.id=m.project_id
    WHERE m.id=${id}::uuid AND m.deleted_at IS NULL`;
  if (!row) throw fail('Ata não encontrada.', 404);
  const session = await requireModule(String(row.project_id), 'minutes');
  const manager = session.role === 'admin' || session.role === 'coordinator';
  const canEdit = manager || row.created_by === session.user.id;
  if (write && !canEdit) throw fail('Somente quem criou a ata ou a coordenação do projeto pode alterá-la.', 403);
  return { session, row, manager, canEdit };
}

type Row = Record<string, unknown>;
export async function draftOf(row: Row): Promise<MinuteDraft> {
  const people = await sql`SELECT * FROM meeting_minute_participants WHERE minute_id=${row.id}::uuid ORDER BY position`;
  return {
    title: String(row.title), subject: String(row.subject), meetingDate: row.meeting_day ? String(row.meeting_day) : ymd(row.meeting_date), startsAt: hm(row.starts_at), endsAt: hm(row.ends_at),
    modality: row.modality as MinuteDraft['modality'], location: String(row.location), platform: String(row.platform), chairedBy: String(row.chaired_by), draftedBy: String(row.drafted_by),
    objective: String(row.objective), place: String(row.place), header: { ...DEFAULT_HEADER, ...(row.header as object) }, intro: (row.intro ?? null) as MinuteDraft['intro'],
    topics: (row.topics ?? []) as MinuteDraft['topics'], decisions: (row.decisions ?? null) as MinuteDraft['decisions'], nextMeeting: { date: null, time: null, notes: '', ...(row.next_meeting as object) },
    closing: (row.closing ?? null) as MinuteDraft['closing'], attachments: (row.attachments ?? []) as MinuteDraft['attachments'],
    participants: people.map((p) => ({ scholarId: p.scholar_id ? String(p.scholar_id) : null, authUserId: p.auth_user_id ? String(p.auth_user_id) : null, name: String(p.name), institution: String(p.institution), role: String(p.role), email: String(p.email), cpf: String(p.cpf ?? ''), phone: String(p.phone ?? ''), attendance: p.attendance as MinuteDraft['participants'][number]['attendance'], signs: Boolean(p.signs) }))
  };
}

/* Input ------------------------------------------------------------------------------------------ */
const rich = z.object({ type: z.literal('doc'), content: z.array(z.any()).max(800) }).passthrough();
type TopicIn = { id: string; title: string; body: z.infer<typeof rich>; children: TopicIn[] };
const topic: z.ZodType<TopicIn> = z.lazy(() => z.object({ id: z.string().min(1).max(60), title: z.string().max(300), body: rich, children: z.array(topic).max(30) }));
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal('').transform(() => null));
const optTime = z.string().regex(/^\d{2}:\d{2}$/).nullable().or(z.literal('').transform(() => null));
const participant = z.object({
  scholarId: z.string().uuid().nullable(), authUserId: z.string().min(1).max(80).nullable(), name: z.string().trim().min(1).max(200), institution: z.string().trim().max(200),
  role: z.string().trim().max(200), email: z.string().trim().max(200), cpf: z.string().max(20).default(''), phone: z.string().max(35).default(''), attendance: z.enum(['present', 'absent', 'justified', 'guest']), signs: z.boolean()
  // A member without an account may be marked to sign: external members sign by the public link
  // (their CPF and WhatsApp are checked against the record when the ata is sent).
}).refine((p) => !p.signs || ((p.attendance === 'present' || p.attendance === 'guest') && (!!p.authUserId || !!p.scholarId || (p.attendance === 'guest' && !!normalizeCpf(p.cpf) && /^\d{12,15}$/.test(guestPhone(p.phone))))), { message: 'Para assinar: membro presente, ou convidado externo com CPF válido e WhatsApp com DDI e DDD.' });
export const draftInput = z.object({
  title: z.string().trim().min(1).max(200), subject: z.string().trim().max(400), meetingDate: optDate, startsAt: optTime, endsAt: optTime,
  modality: z.enum(['online', 'presencial', 'hibrida']), location: z.string().trim().max(300), platform: z.string().trim().max(120), chairedBy: z.string().trim().max(200), draftedBy: z.string().trim().max(200),
  objective: z.string().trim().max(2000), place: z.string().trim().max(120),
  header: z.object({ lines: z.array(z.string().max(200)).max(4), address: z.string().max(300), footer: z.string().max(160) }),
  intro: rich.nullable(), topics: z.array(topic).max(60), decisions: rich.nullable(), closing: rich.nullable(),
  nextMeeting: z.object({ date: optDate, time: optTime, notes: z.string().max(2000) }),
  attachments: z.array(z.object({ key: z.string().max(400), name: z.string().max(200), mime: z.string().max(120), size: z.number().int().nonnegative(), caption: z.string().max(500), width: z.number().optional(), height: z.number().optional() })).max(40),
  participants: z.array(participant).max(120)
}).refine((d) => JSON.stringify(d).length < 900_000, { message: 'A ata ficou grande demais. Mova imagens para os anexos.' });

/** Saves the editable draft (participants are replaced as a whole). */
export async function saveDraft(id: string, projectId: string, userId: string, d: z.infer<typeof draftInput>) {
  const folder = minuteFolder(projectId, id);
  if (d.attachments.some((a) => !a.key.startsWith(folder))) throw fail('Anexo inválido para esta ata.', 400);
  const json = (v: unknown) => JSON.stringify(v ?? null);
  await sql.transaction([
    sql`UPDATE meeting_minutes SET title=${d.title},subject=${d.subject},meeting_date=${d.meetingDate}::date,starts_at=${d.startsAt}::time,ends_at=${d.endsAt}::time,modality=${d.modality},
      location=${d.location},platform=${d.platform},chaired_by=${d.chairedBy},drafted_by=${d.draftedBy},objective=${d.objective},place=${d.place},header=${json(d.header)}::jsonb,
      intro=${json(d.intro)}::jsonb,topics=${json(d.topics)}::jsonb,decisions=${json(d.decisions)}::jsonb,next_meeting=${json(d.nextMeeting)}::jsonb,closing=${json(d.closing)}::jsonb,
      attachments=${json(d.attachments)}::jsonb,status='editing',updated_by=${userId},updated_at=now() WHERE id=${id}::uuid AND status IN ('draft','editing')`,
    sql`DELETE FROM meeting_minute_participants WHERE minute_id=${id}::uuid`,
    ...d.participants.map((p, i) => sql`INSERT INTO meeting_minute_participants(minute_id,position,scholar_id,auth_user_id,name,institution,role,email,attendance,signs,cpf,phone)
      VALUES(${id}::uuid,${i},${p.scholarId}::uuid,${p.authUserId},${p.name},${p.institution},${p.role},${p.email},${p.attendance},${p.signs},${p.cpf},${p.phone})`),
    sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id) VALUES(${userId},${projectId}::uuid,'update','meeting_minute',${id})`
  ]);
  // The first save gives the ata its number.
  return assignNumber(id, projectId, userId);
}

const currentYear = () => Number(new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date()));
/** New ata: a draft without number (it is numbered at the first save), header copied from the last ata. */
export async function createMinute(projectId: string, userId: string, drafter: string) {
  const [last] = await sql`SELECT header,place FROM meeting_minutes WHERE project_id=${projectId}::uuid AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`;
  const [row] = await sql`INSERT INTO meeting_minutes(project_id,year,seq,created_by,drafted_by,header,place)
    VALUES(${projectId}::uuid,${currentYear()},NULL,${userId},${drafter},${JSON.stringify(last?.header ?? DEFAULT_HEADER)}::jsonb,${String(last?.place ?? 'Palmas, TO')}) RETURNING id`;
  await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id) VALUES(${userId},${projectId}::uuid,'create','meeting_minute',${String(row.id)})`;
  return { id: String(row.id), number: minuteNumber(null, currentYear()) };
}

/** Gives the ata the next number of the year (only atas not deleted count). No-op when it already has one. */
export async function assignNumber(id: string, projectId: string, userId: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const year = currentYear();
      const [row] = await sql`UPDATE meeting_minutes SET year=${year},seq=(SELECT coalesce(max(seq),0)+1 FROM meeting_minutes WHERE project_id=${projectId}::uuid AND year=${year} AND deleted_at IS NULL)
        WHERE id=${id}::uuid AND seq IS NULL RETURNING seq,year`;
      if (!row) { const [cur] = await sql`SELECT seq,year FROM meeting_minutes WHERE id=${id}::uuid`; return minuteNumber(Number(cur?.seq), Number(cur?.year)); }
      const number = minuteNumber(Number(row.seq), Number(row.year));
      await sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${userId},${projectId}::uuid,'number_minute','meeting_minute',${id},jsonb_build_object('number',${number}::text))`;
      return number;
    } catch (error) { if ((error as { code?: string }).code !== '23505' || attempt === 3) throw error; } // two first saves at once: retry with the next number
  }
  throw fail('Não foi possível numerar a ata. Tente novamente.', 409);
}

/** People who may attend: members of the project and accounts with access, with the institution last used. */
export async function participantCandidates(projectId: string) {
  const [scholars, accounts, used] = await Promise.all([
    sql`SELECT id,full_name,role_area,email,status,auth_user_id,affiliation,cpf,phone FROM scholars WHERE project_id=${projectId}::uuid AND deleted_at IS NULL ORDER BY full_name`,
    signerCandidates(projectId),
    sql`SELECT DISTINCT ON (coalesce(p.scholar_id::text,p.auth_user_id,lower(p.name))) coalesce(p.scholar_id::text,p.auth_user_id,lower(p.name)) AS who,p.institution
      FROM meeting_minute_participants p JOIN meeting_minutes m ON m.id=p.minute_id WHERE m.project_id=${projectId}::uuid AND p.institution<>'' ORDER BY coalesce(p.scholar_id::text,p.auth_user_id,lower(p.name)),m.created_at DESC`
  ]);
  const institution = new Map(used.map((u) => [String(u.who), String(u.institution)]));
  const STATUS: Record<string, string> = { active: 'Ativo', suspended: 'Suspenso', finished: 'Encerrado' };
  // external: member marked "Externo" in the record. Without an account, they sign by the public
  // link, so the record needs a valid CPF and a WhatsApp number (guestReady; the CPF itself stays on the server).
  type Candidate = { scholarId: string | null; authUserId: string | null; name: string; role: string; email: string; institution: string; registration: string; pendingFirstAccess: boolean; external: boolean; guestReady: boolean };
  const list: Candidate[] = scholars.map((s) => {
    // signerCandidates only links a member to an account with the same e-mail.
    const account = accounts.find((a) => a.scholarId === s.id) ?? (!String(s.email ?? '').trim() ? accounts.find((a) => s.auth_user_id && a.authUserId === s.auth_user_id) : undefined);
    const external = s.affiliation === 'Externo';
    return { scholarId: String(s.id), authUserId: account?.authUserId ?? null, name: String(s.full_name), role: String(s.role_area || account?.roleLabel || ''), email: String(s.email || account?.email || ''),
      // The institution comes from the member record (UFT or Externo).
      institution: String(s.affiliation || 'UFT'), registration: STATUS[String(s.status)] ?? String(s.status), pendingFirstAccess: !!account?.pendingFirstAccess,
      external, guestReady: external && !!normalizeCpf(String(s.cpf ?? '')) && /^\d{12,15}$/.test(guestPhone(String(s.phone ?? ''))) };
  });
  for (const a of accounts) if (!list.some((p) => p.authUserId === a.authUserId)) list.push({ scholarId: null, authUserId: a.authUserId, name: a.name, role: a.roleLabel, email: a.email, institution: institution.get(a.authUserId) ?? '', registration: 'Conta de acesso', pendingFirstAccess: a.pendingFirstAccess, external: false, guestReady: false });
  return list;
}

/** Full view of an ata for the editor: draft, active version and its signature control. */
export async function minuteView(id: string) {
  const access = await minuteAccess(id), row = access.row;
  const [version] = await sql`SELECT id,version,content_hash,public_code,status,issued_at FROM meeting_minute_versions WHERE minute_id=${id}::uuid ORDER BY version DESC LIMIT 1`;
  const signatures = version ? await versionSignatures(String(version.id)) : { request: null, signers: [] };
  // Who is writing the ata: shown to others, who open it read-only.
  const [author] = await sql`SELECT coalesce(s.full_name,u.name,u.email) AS name FROM neon_auth."user" u
    LEFT JOIN scholars s ON s.project_id=${row.project_id}::uuid AND s.deleted_at IS NULL AND s.email<>'' AND lower(s.email)=lower(u.email) WHERE u.id::text=${row.created_by}`;
  const signed = signatures.signers.filter((s) => s.status === 'signed').length;
  const status = displayStatus(row.status as MinuteStatus, signatures.request ? { status: String(signatures.request.status), signed, total: signatures.signers.length } : null);
  return {
    id, projectId: String(row.project_id), projectTitle: String(row.project_title), number: minuteNumber(Number(row.seq), Number(row.year)), status: String(row.status), displayStatus: status,
    statusReason: row.status_reason ? String(row.status_reason) : null, canEdit: access.canEdit, author: String(author?.name ?? ''), isAuthor: row.created_by === access.session.user.id, manager: access.manager, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    draft: await draftOf(row),
    version: version ? { id: String(version.id), version: Number(version.version), contentHash: String(version.content_hash), publicCode: String(version.public_code), status: String(version.status), issuedAt: new Date(version.issued_at as string).toISOString(), verifyUrl: minuteVerifyLink(String(version.public_code)) } : null,
    request: signatures.request ? requestView(signatures.request, signatures.signers as never) : null
  };
}

/** Freezes the draft as version N: content, hash and public code never change afterwards. */
export async function finalizeMinute(id: string) {
  const first = await minuteAccess(id, true);
  if (!['draft', 'editing'].includes(String(first.row.status))) throw fail('Esta ata já foi finalizada.', 409);
  if (!first.row.seq) { await assignNumber(id, String(first.row.project_id), first.session.user.id); }
  const access = first.row.seq ? first : await minuteAccess(id, true), row = access.row;
  const draft = await draftOf(row);
  const problems = [!draft.subject.trim() && 'o assunto', !draft.meetingDate && 'a data da reunião', !draft.participants.some((p) => p.attendance === 'present') && 'ao menos um participante presente', !draft.topics.length && 'ao menos um tópico'].filter(Boolean);
  if (problems.length) throw fail(`Para finalizar, informe ${problems.join(', ')}.`, 400);
  const content = freezeContent(draft, { number: minuteNumber(Number(row.seq), Number(row.year)), projectTitle: String(row.project_title) });
  const versionId = crypto.randomUUID(), hash = versionHash(versionId, content);
  const [{ next }] = await sql`SELECT coalesce(max(version),0)+1 AS next FROM meeting_minute_versions WHERE minute_id=${id}::uuid`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newPublicCode();
    try {
      const [, updated] = await sql.transaction([
        sql`INSERT INTO meeting_minute_versions(id,minute_id,version,content,content_hash,public_code,issued_by) VALUES(${versionId}::uuid,${id}::uuid,${Number(next)},${JSON.stringify(content)}::jsonb,${hash},${code},${access.session.user.id})`,
        sql`UPDATE meeting_minutes SET status='finalized',status_reason=NULL,updated_by=${access.session.user.id},updated_at=now() WHERE id=${id}::uuid AND status IN ('draft','editing') RETURNING id`,
        sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${access.session.user.id},${row.project_id}::uuid,'finalize','meeting_minute',${id},jsonb_build_object('version',${Number(next)}::int,'contentHash',${hash}::text,'code',${code}::text))`
      ]) as unknown as Array<Array<{ id: string }>>;
      if (!updated.length) throw fail('A ata mudou de situação. Atualize a página.', 409);
      return { versionId, version: Number(next), publicCode: code, contentHash: hash };
    } catch (error) { if ((error as { code?: string }).code !== '23505' || attempt === 2) throw error; }
  }
  throw fail('Não foi possível emitir a versão. Tente novamente.', 409);
}

/** Back to editing: the version is superseded. With signatures, only the coordination may do it, with a reason. */
export async function reopenMinute(id: string, reason: string) {
  const access = await minuteAccess(id, true), row = access.row;
  if (row.status !== 'finalized') throw fail('Somente atas finalizadas podem ser reabertas.', 409);
  const [version] = await sql`SELECT id FROM meeting_minute_versions WHERE minute_id=${id}::uuid AND status='active'`;
  const { request, signers } = version ? await versionSignatures(String(version.id)) : { request: null, signers: [] };
  const signed = signers.some((s) => s.status === 'signed');
  if (signed && !access.manager) throw fail('A ata já tem assinaturas: somente a coordenação pode cancelá-las para reabrir.', 403);
  if (signed && reason.trim().length < 5) throw fail('Informe o motivo: as assinaturas já registradas serão canceladas.', 400);
  const why = reason.trim() || 'Ata reaberta para edição.';
  await sql.transaction([
    ...(request ? [sql`UPDATE signature_requests SET status='cancelled',closed_reason=${why} WHERE id=${request.id}::uuid AND status IN ('pending','completed')`] : []),
    ...(version ? [sql`UPDATE meeting_minute_versions SET status='superseded',closed_at=now() WHERE id=${version.id}::uuid`] : []),
    sql`UPDATE meeting_minutes SET status='editing',status_reason=NULL,updated_by=${access.session.user.id},updated_at=now() WHERE id=${id}::uuid`,
    sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${access.session.user.id},${row.project_id}::uuid,'reopen','meeting_minute',${id},jsonb_build_object('reason',${why}::text,'signaturesCancelled',${signed}::boolean))`
  ]);
}

/** Opens the simultaneous signature request of the active version with the existing mechanism. */
export async function sendForSignature(id: string, request: Request) {
  const access = await minuteAccess(id, true), row = access.row;
  if (row.status !== 'finalized') throw fail('Finalize a ata antes de encaminhá-la para assinatura.', 409);
  const [version] = await sql`SELECT id,content_hash,content FROM meeting_minute_versions WHERE minute_id=${id}::uuid AND status='active'`;
  if (!version) throw fail('A ata não tem versão emitida.', 409);
  const draft = await draftOf(row);
  // The account of each member is resolved again now: a link corrected after the ata was written wins.
  const current = new Map((await participantCandidates(String(row.project_id))).filter((c) => c.scholarId).map((c) => [c.scholarId!, c.authUserId]));
  const records = new Map((await sql`SELECT id,cpf,phone,affiliation FROM scholars WHERE project_id=${row.project_id}::uuid AND deleted_at IS NULL`).map((s) => [String(s.id), s]));
  const chosen = draft.participants.map((p) => {
    const linked = p.scholarId && current.has(p.scholarId) ? { ...p, authUserId: current.get(p.scholarId) ?? null } : p;
    // External member without an account: signs by the public link with the CPF and WhatsApp of the record.
    const record = linked.scholarId ? records.get(linked.scholarId) : undefined;
    return !linked.authUserId && record?.affiliation === 'Externo' ? { ...linked, cpf: String(record.cpf ?? ''), phone: String(record.phone ?? ''), externalMember: true } : { ...linked, externalMember: false };
  }).filter((p) => p.signs);
  if (!chosen.length) throw fail('Marque em Participantes quem deve assinar a ata.', 400);
  const accounts = new Map((await signerCandidates(String(row.project_id))).map((c) => [c.authUserId, c]));
  const guests = chosen.filter((p) => !p.authUserId && (p.externalMember || (!p.scholarId && p.attendance === 'guest')));
  const missing = chosen.filter((p) => !guests.includes(p) && !accounts.has(p.authUserId!));
  if (missing.length) throw fail(`Sem acesso ativo ao projeto: ${missing.map((p) => p.name).join(', ')}. Crie um acesso de assinatura em Configurações ou, se for membro externo, marque "Externo" no cadastro.`, 400);
  for (const p of guests) {
    if (!normalizeCpf(p.cpf ?? '') || !/^\d{12,15}$/.test(guestPhone(p.phone ?? ''))) throw fail(p.externalMember ? `${p.name} é membro externo: informe no cadastro um CPF válido e o WhatsApp com DDI e DDD.` : `Confira CPF e WhatsApp de ${p.name}.`, 400);
    if (p.email.trim() && [...accounts.values()].some(a => a.email.toLowerCase() === p.email.trim().toLowerCase())) throw fail(`${p.name}: este e-mail já tem conta no projeto. Inclua a pessoa pelo cadastro para assinar com seu próprio login.`, 400);
    const [member] = await sql`SELECT 1 FROM signer_identities WHERE cpf=${normalizeCpf(p.cpf!)} OR (phone<>'' AND phone=${guestPhone(p.phone!)})`;
    if (member) throw fail(`${p.name}: CPF ou telefone já vinculado a uma conta. Inclua a pessoa pelo cadastro e solicite sua assinatura pelo login.`, 400);
  }
  const keys = chosen.map(p => p.authUserId || normalizeCpf(p.cpf ?? ''));
  if (new Set(keys).size !== chosen.length) throw fail('Há signatários repetidos na ata. Confira as contas e os CPFs dos convidados.', 400);
  const slots = chosen.map((p) => {
    const account = p.authUserId ? accounts.get(p.authUserId) : null;
    return { ...p, name: account?.name ?? p.name, role: account?.roleLabel ?? p.role, signerId: crypto.randomUUID(), authUserId: account?.authUserId ?? `external:${crypto.randomUUID()}`, external: !account };
  });
  const requestId = crypto.randomUUID(), label = `${minuteNumber(Number(row.seq), Number(row.year))} — ${String(row.subject) || String(row.title)}`;
  try {
    await sql.transaction([
      sql`INSERT INTO signature_requests(id,project_id,source_kind,source_id,label,created_by,mode,document_hash) VALUES(${requestId}::uuid,${row.project_id}::uuid,'minutes',${version.id}::uuid,${label},${access.session.user.id},'parallel',${String(version.content_hash)})`,
      ...slots.flatMap((p, i) => [sql`INSERT INTO signature_signers(id,request_id,step,auth_user_id,name,role_label,status) VALUES(${p.signerId}::uuid,${requestId}::uuid,${i + 1},${p.authUserId},${p.name},${[p.role, p.institution].filter(Boolean).join(' / ')},'pending')`, ...(p.external ? [guestSlot(p.signerId, normalizeCpf(p.cpf!)!, p.phone!)] : [])]),
      sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${access.session.user.id},${row.project_id}::uuid,'request_signatures','signature_request',${requestId},jsonb_build_object('kind','minutes'::text,'minuteId',${id}::text,'signers',${chosen.length}::int,'mode','parallel'::text,'ip',${clientIp(request)}::text))`
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw fail('Esta ata já tem uma solicitação de assinatura em andamento.', 409);
    throw error;
  }
  return { requestId, signers: chosen.length };
}

/** Archive, unarchive, cancel (with reason) or delete a draft never issued. */
export async function changeStatus(id: string, action: 'archive' | 'unarchive' | 'cancel' | 'delete', reason: string) {
  if (action === 'delete') return deleteMinute(id, reason);
  const access = await minuteAccess(id, true), row = access.row, user = access.session.user.id;
  const audit = sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${user},${row.project_id}::uuid,${`${action}_minute`},'meeting_minute',${id},jsonb_build_object('reason',${reason}::text))`;
  if (action === 'archive') { if (row.status !== 'finalized') throw fail('Somente atas finalizadas são arquivadas.', 409); await sql.transaction([sql`UPDATE meeting_minutes SET status='archived',updated_at=now() WHERE id=${id}::uuid`, audit]); return; }
  if (action === 'unarchive') { if (row.status !== 'archived') throw fail('A ata não está arquivada.', 409); await sql.transaction([sql`UPDATE meeting_minutes SET status='finalized',updated_at=now() WHERE id=${id}::uuid`, audit]); return; }
  if (!access.manager) throw fail('Somente a coordenação cancela atas.', 403);
  if (reason.trim().length < 5) throw fail('Informe o motivo do cancelamento.', 400);
  if (row.status === 'cancelled') throw fail('A ata já está cancelada.', 409);
  await sql.transaction([
    sql`UPDATE signature_requests SET status='cancelled',closed_reason=${`Ata cancelada: ${reason}`} WHERE source_kind='minutes' AND status='pending' AND source_id IN (SELECT id FROM meeting_minute_versions WHERE minute_id=${id}::uuid)`,
    sql`UPDATE meeting_minute_versions SET status='cancelled',closed_at=now() WHERE minute_id=${id}::uuid AND status='active'`,
    sql`UPDATE meeting_minutes SET status='cancelled',status_reason=${reason},updated_at=now() WHERE id=${id}::uuid`,
    audit
  ]);
}

/** List of the project's atas with what the filters search (participants, responsible, signatures). */
export async function listMinutes(projectId: string) {
  await requireModule(projectId, 'minutes');
  const rows = await sql`SELECT m.id,m.seq,m.year,m.title,m.subject,to_char(m.meeting_date,'YYYY-MM-DD') AS meeting_day,m.status,m.chaired_by,m.drafted_by,m.updated_at,
      coalesce((SELECT json_agg(p.name ORDER BY p.position) FROM meeting_minute_participants p WHERE p.minute_id=m.id AND p.attendance IN ('present','guest')),'[]') AS people,
      v.public_code,v.version,r.status AS request_status,
      (SELECT count(*) FROM signature_signers s WHERE s.request_id=r.id) AS total,(SELECT count(*) FROM signature_signers s WHERE s.request_id=r.id AND s.status='signed') AS signed
    FROM meeting_minutes m
    LEFT JOIN LATERAL (SELECT id,public_code,version FROM meeting_minute_versions WHERE minute_id=m.id ORDER BY version DESC LIMIT 1) v ON true
    LEFT JOIN LATERAL (SELECT id,status FROM signature_requests WHERE source_kind='minutes' AND source_id=v.id AND status IN ('pending','completed') ORDER BY created_at DESC LIMIT 1) r ON true
    WHERE m.project_id=${projectId}::uuid AND m.deleted_at IS NULL ORDER BY (m.seq IS NULL) DESC,m.year DESC,m.seq DESC,m.created_at DESC`;
  return rows.map((r) => {
    const total = Number(r.total ?? 0), signed = Number(r.signed ?? 0);
    return {
      id: String(r.id), number: minuteNumber(Number(r.seq), Number(r.year)), title: String(r.title), subject: String(r.subject), meetingDate: r.meeting_day ? String(r.meeting_day) : null,
      status: String(r.status), displayStatus: displayStatus(r.status as MinuteStatus, r.request_status ? { status: String(r.request_status), signed, total } : null),
      chairedBy: String(r.chaired_by), draftedBy: String(r.drafted_by), participants: r.people as string[], updatedAt: new Date(r.updated_at as string).toISOString(),
      publicCode: r.public_code ? String(r.public_code) : null, version: r.version ? Number(r.version) : null, signatures: { signed, total }
    };
  });
}

/**
 * Deletes an ata. Without signatures, anyone with the Atas module may do it; with at least one
 * signature (partial or complete), only the administration, with a reason. Signature requests
 * are cancelled, issued versions become "cancelada" (the public verification then says so, so an
 * old PDF cannot pass as valid), and the stored files (official PDFs, annexes, images and the
 * signed copy in Documents) are removed; the rows stay, deleted, for the audit trail.
 */
export async function deleteMinute(id: string, reason: string) {
  const access = await minuteAccess(id), row = access.row, user = access.session.user.id, why = reason.trim();
  const [signed] = await sql`SELECT 1 FROM signature_signers s JOIN signature_requests r ON r.id=s.request_id
    WHERE r.source_kind='minutes' AND r.status IN ('pending','completed') AND s.status='signed'
      AND r.source_id IN (SELECT id FROM meeting_minute_versions WHERE minute_id=${id}::uuid) LIMIT 1`;
  if (signed && access.session.role !== 'admin') throw fail('Esta ata já tem assinaturas: somente a administração pode excluí-la.', 403);
  if (signed && why.length < 5) throw fail('Informe o motivo: as assinaturas registradas serão canceladas.', 400);
  const folder = minuteFolder(String(row.project_id), id);
  const versions = await sql`SELECT id,content FROM meeting_minute_versions WHERE minute_id=${id}::uuid`;
  const renders = await sql`SELECT storage_key FROM meeting_minute_renders WHERE version_id IN (SELECT id FROM meeting_minute_versions WHERE minute_id=${id}::uuid)`;
  const archived = await sql`SELECT d.id,d.storage_key FROM signature_requests r JOIN documents d ON d.id=r.archived_document_id
    WHERE r.source_kind='minutes' AND r.source_id IN (SELECT id FROM meeting_minute_versions WHERE minute_id=${id}::uuid)`;
  const draft = await draftOf(row);
  const keys = new Set<string>([
    ...renders.map((r) => String(r.storage_key)), ...archived.map((d) => String(d.storage_key)),
    ...draft.attachments.map((a) => a.key), ...contentImageKeys({ ...draft, decisions: draft.decisions ?? { type: 'doc', content: [] }, intro: draft.intro ?? { type: 'doc', content: [] }, closing: draft.closing ?? { type: 'doc', content: [] } }, folder),
    ...versions.flatMap((v) => { const c = v.content as Parameters<typeof contentImageKeys>[0]; return [...c.attachments.map((a) => a.key), ...contentImageKeys(c, folder)]; })
  ].filter((k) => k.startsWith(folder) || archived.some((d) => d.storage_key === k)));
  const closed = signed ? `Ata excluída pela administração: ${why}` : 'Ata excluída.';
  await sql.transaction([
    sql`UPDATE signature_requests SET status='cancelled',closed_reason=${closed} WHERE source_kind='minutes' AND status IN ('pending','completed')
      AND source_id IN (SELECT id FROM meeting_minute_versions WHERE minute_id=${id}::uuid)`,
    sql`UPDATE meeting_minute_versions SET status='cancelled',closed_at=now() WHERE minute_id=${id}::uuid AND status<>'cancelled'`,
    ...(archived.length ? [sql`UPDATE documents SET deleted_at=now(),deleted_by=${user},delete_reason=${closed} WHERE id=ANY(${archived.map((d) => String(d.id))}::uuid[]) AND deleted_at IS NULL`] : []),
    sql`UPDATE meeting_minutes SET status='cancelled',status_reason=${closed},deleted_at=now(),updated_by=${user} WHERE id=${id}::uuid`,
    sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${user},${row.project_id}::uuid,'delete_minute','meeting_minute',${id},
      jsonb_build_object('reason',${why}::text,'hadSignatures',${!!signed}::boolean,'versions',${versions.length}::int,'files',${keys.size}::int))`
  ]);
  await deletePrivateObjects([...keys]);
}
