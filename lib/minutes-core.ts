import { sql } from './db';
import { APP_URL, sha256, signatureHashOf, stableJson } from './hash';
import { putPrivateObject, readPrivateObject } from './storage';
import { displayStatus, minuteNumber, STATUS_LABEL, type MinuteContent, type MinuteStatus, type RichNode } from './minutes-model';
import { imageKey, minutesPdf, signatureId, type MinuteSignature } from '../server/services/minutes-pdf';

// Frozen versions of the atas, their official PDFs and the public verification.
// Nothing here depends on lib/signatures (which imports this module).

const fail = (message: string, status: number) => Object.assign(new Error(message), { status });
export const minuteVerifyLink = (code: string) => `${APP_URL}/verificar-documento/${code}`;
/** SHA-256 of the frozen content, with the same rule as the other signed documents. */
export const versionHash = (versionId: string, content: MinuteContent) => sha256(stableJson({ kind: 'minutes', sourceId: versionId, content }));

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I: easy to type from paper
/** Public code: 16 random characters (80 bits), not derived from any internal id. */
export function newPublicCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return Array.from(random(16), (b) => ALPHABET[b % 32]).join('').replace(/(.{4})(?=.)/g, '$1-');
}
export function normalizePublicCode(input: string) {
  const raw = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.length === 16 && [...raw].every((c) => ALPHABET.includes(c)) ? raw.replace(/(.{4})(?=.)/g, '$1-') : null;
}
export const PUBLIC_CODE_PATTERN = /[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/;

export type VersionRow = { id: string; minute_id: string; version: number; content: MinuteContent; content_hash: string; public_code: string; status: string; issued_at: Date | string; project_id: string; minute_status: MinuteStatus; seq: number; year: number; project_title: string };
export async function minuteVersion(versionId: string) {
  const [v] = await sql`SELECT v.*,m.project_id,m.status AS minute_status,m.seq,m.year,p.title AS project_title FROM meeting_minute_versions v
    JOIN meeting_minutes m ON m.id=v.minute_id JOIN projects p ON p.id=m.project_id WHERE v.id=${versionId}::uuid`;
  if (!v) throw fail('Versão da ata não encontrada.', 404);
  return v as unknown as VersionRow;
}

/** The ata as a signed source: the frozen content, after checking that it still matches its hash. */
export async function minuteSource(projectId: string, versionId: string) {
  const v = await minuteVersion(versionId);
  if (String(v.project_id) !== projectId) throw fail('Ata não encontrada neste projeto.', 404);
  const hash = versionHash(v.id, v.content);
  if (hash !== v.content_hash) throw fail('Falha de integridade: o conteúdo registrado da ata não corresponde ao hash emitido.', 409);
  return { version: v, hash, label: `${v.content.number} — ${v.content.subject || v.content.title}` };
}

const iso = (d: unknown) => d instanceof Date ? d.toISOString() : String(d);
type SignerRecord = { id: string; step: number; auth_user_id: string; name: string; role_label: string; status: string; cpf: string | null; signed_at: Date | string | null; ip: string | null; document_hash: string | null; signature_hash: string | null };
/** Current signature request of a version (open or completed) and its signers. */
export async function versionSignatures(versionId: string) {
  const [request] = await sql`SELECT * FROM signature_requests WHERE source_kind='minutes' AND source_id=${versionId}::uuid AND status IN ('pending','completed') ORDER BY created_at DESC LIMIT 1`;
  const signers = request ? await sql`SELECT * FROM signature_signers WHERE request_id=${request.id}::uuid ORDER BY step` as unknown as SignerRecord[] : [];
  return { request: request ?? null, signers };
}
const printable = (s: SignerRecord): MinuteSignature => ({ name: s.name, roleLabel: s.role_label, signedAt: iso(s.signed_at), signatureHash: String(s.signature_hash) });

/** Storage keys printed by the ata (images in the text and annexes), limited to its own folder. */
export function contentImageKeys(content: Pick<MinuteContent, 'topics' | 'intro' | 'closing' | 'decisions' | 'attachments'>, prefix: string) {
  const keys = new Set<string>();
  const walk = (n: RichNode | undefined) => { if (!n) return; if (n.type === 'image') { const k = n.attrs?.key ?? imageKey(n.attrs?.src); if (k) keys.add(String(k)); } n.content?.forEach(walk); };
  [content.intro, content.closing, content.decisions].forEach((d) => d && walk(d as RichNode));
  for (const t of content.topics) { walk(t.body as RichNode); t.children.forEach((c) => walk(c.body as RichNode)); }
  for (const a of content.attachments) if (a.mime.startsWith('image/')) keys.add(a.key);
  return [...keys].filter((k) => k.startsWith(prefix) && !k.includes('..'));
}
export async function loadImages(keys: string[]) {
  const images = new Map<string, Buffer>();
  await Promise.all(keys.map(async (k) => { try { images.set(k, await readPrivateObject(k, 15 * 1024 * 1024)); } catch { /* a missing image must not block the ata */ } }));
  return images;
}
export const minuteFolder = (projectId: string, minuteId: string) => `${projectId}/minutes/${minuteId}/`;

/** Official PDF of a version in its current signature state: stored once, served identically afterwards. */
export async function officialPdf(versionId: string) {
  const v = await minuteVersion(versionId);
  const { request, signers } = await versionSignatures(versionId);
  const signed = signers.filter((s) => s.status === 'signed').sort((a, b) => iso(a.signed_at).localeCompare(iso(b.signed_at)));
  const stateKey = `${request?.id ?? 'none'}:${signed.length}`;
  const filename = `${v.content.number.replace(/[^\w]+/g, '-').replace(/-+$/, '')}${request?.status === 'completed' ? '-assinada' : ''}.pdf`.replace(/^-/, '');
  const [stored] = await sql`SELECT storage_key FROM meeting_minute_renders WHERE version_id=${versionId}::uuid AND state_key=${stateKey}`;
  if (stored) return { buffer: await readPrivateObject(String(stored.storage_key), 40 * 1024 * 1024), mime: 'application/pdf', filename, signatures: signed.length, total: signers.length };
  const folder = minuteFolder(String(v.project_id), v.minute_id);
  const buffer = await minutesPdf(v.content, {
    draft: false, version: v.version, code: v.public_code, verifyUrl: minuteVerifyLink(v.public_code), contentHash: v.content_hash, issuedAt: iso(v.issued_at),
    signatures: signed.map(printable), totalSigners: signers.length, images: await loadImages(contentImageKeys(v.content, folder)),
    createdAt: new Date(signed.length ? iso(signed[signed.length - 1].signed_at) : iso(v.issued_at))
  });
  // Deterministic output: a concurrent render of the same state writes identical bytes.
  const key = `${folder}renders/v${v.version}-${stateKey.replace(/[^\w]+/g, '-')}.pdf`;
  await putPrivateObject(key, buffer, 'application/pdf');
  await sql`INSERT INTO meeting_minute_renders(version_id,state_key,signatures,pdf_sha256,storage_key,size_bytes) VALUES(${versionId}::uuid,${stateKey},${signed.length},${sha256(buffer)},${key},${buffer.length})
    ON CONFLICT (version_id,state_key) DO NOTHING`;
  return { buffer, mime: 'application/pdf', filename, signatures: signed.length, total: signers.length };
}

/* Public verification ---------------------------------------------------------------------------- */
export type VerificationResult = 'signed' | 'partial' | 'unsigned' | 'cancelled' | 'superseded' | 'not_found' | 'integrity_failure';
export const RESULT_TEXT: Record<VerificationResult, string> = {
  signed: 'Documento íntegro e totalmente assinado', partial: 'Documento íntegro e parcialmente assinado', unsigned: 'Documento íntegro, ainda sem assinaturas',
  cancelled: 'Documento cancelado', superseded: 'Documento substituído por versão posterior', not_found: 'Documento não localizado', integrity_failure: 'Falha de integridade'
};

/** Checks the stored records (content hash, each signature hash, situation); never just "the code exists". */
export async function verifyMinute(code: string) {
  const normalized = normalizePublicCode(code);
  if (!normalized) return { result: 'not_found' as VerificationResult, text: RESULT_TEXT.not_found, code: String(code).slice(0, 40) };
  const [row] = await sql`SELECT v.*,m.project_id,m.status AS minute_status,m.seq,m.year,m.subject,m.meeting_date,p.title AS project_title,
      (SELECT max(version) FROM meeting_minute_versions x WHERE x.minute_id=v.minute_id) AS latest
    FROM meeting_minute_versions v JOIN meeting_minutes m ON m.id=v.minute_id JOIN projects p ON p.id=m.project_id WHERE v.public_code=${normalized}`;
  if (!row) return { result: 'not_found' as VerificationResult, text: RESULT_TEXT.not_found, code: normalized };
  const v = row as unknown as VersionRow & { subject: string; meeting_date: Date | string | null; latest: number };
  const contentOk = versionHash(v.id, v.content) === v.content_hash;
  const { request, signers } = await versionSignatures(v.id);
  const people = signers.map((s) => {
    const signed = s.status === 'signed';
    const valid = !signed || (s.document_hash === v.content_hash && !!s.cpf && s.signature_hash === signatureHashOf({ documentHash: v.content_hash, requestId: String(request!.id), step: s.step, userId: s.auth_user_id, cpf: String(s.cpf), signedAt: iso(s.signed_at), ip: String(s.ip ?? '') }));
    return { name: s.name, roleLabel: s.role_label, status: signed ? 'signed' : s.status === 'rejected' ? 'rejected' : 'pending', signedAt: signed ? iso(s.signed_at) : null, signatureId: signed ? signatureId(String(s.signature_hash)) : null, valid };
  });
  const requestOk = !request || !request.document_hash || request.document_hash === v.content_hash;
  const done = people.filter((p) => p.status === 'signed').length, total = people.length;
  const result: VerificationResult = !contentOk || !requestOk || people.some((p) => !p.valid) ? 'integrity_failure'
    : v.status === 'cancelled' || v.minute_status === 'cancelled' ? 'cancelled'
    : v.status === 'superseded' ? 'superseded'
    : request?.status === 'completed' ? 'signed' : done ? 'partial' : 'unsigned';
  const status = displayStatus(v.minute_status, request ? { status: String(request.status), signed: done, total } : null);
  return {
    result, text: RESULT_TEXT[result], code: normalized, type: 'Ata de Reunião', number: minuteNumber(v.seq, v.year), project: v.project_title, subject: v.content.subject,
    meetingDate: v.content.meetingDate, issuedAt: iso(v.issued_at), version: v.version, latestVersion: Number(v.latest), situation: STATUS_LABEL[status],
    signatures: { done, total }, signers: people.map(({ valid: _v, ...p }) => p), contentHash: v.content_hash, checkedAt: new Date().toISOString(),
    checks: { content: contentOk, signatures: people.every((p) => p.valid) && requestOk }
  };
}

/** Compares an uploaded PDF with the official files issued by the platform. */
export async function verifyPdfFile(buffer: Buffer, extractText: (b: Buffer) => Promise<string>) {
  const digest = sha256(buffer);
  const [render] = await sql`SELECT r.signatures,r.created_at,v.public_code,v.id AS version_id,(SELECT max(signatures) FROM meeting_minute_renders x WHERE x.version_id=r.version_id) AS latest
    FROM meeting_minute_renders r JOIN meeting_minute_versions v ON v.id=r.version_id WHERE r.pdf_sha256=${digest} LIMIT 1`;
  if (render) return { match: true, sha256: digest, signaturesInFile: Number(render.signatures), latestSignatures: Number(render.latest), issuedAt: iso(render.created_at), verification: await verifyMinute(String(render.public_code)) };
  // Not an official file: tell whether it claims to be one of our atas (then it was altered or re-saved).
  let found = PUBLIC_CODE_PATTERN.exec(buffer.toString('latin1'))?.[0] ?? null;
  if (!found) { try { found = PUBLIC_CODE_PATTERN.exec(await extractText(buffer))?.[0] ?? null; } catch { /* unreadable PDF */ } }
  const verification = found ? await verifyMinute(found) : null;
  return { match: false, sha256: digest, claimedCode: verification && verification.result !== 'not_found' ? found : null, verification: verification && verification.result !== 'not_found' ? verification : null };
}
