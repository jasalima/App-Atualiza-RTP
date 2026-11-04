import { createHash } from 'node:crypto';
import { requireUser } from './authorize';
import { sql } from './db';
import { readPrivateObject } from './storage';
import { beneficiaryOf, travelFill, travelReportById, type TravelPhoto } from './travel';
import type { SignatureManifest } from '../server/services/signature-stamp';
import type { TravelFill } from '../server/services/travel-export';
import type { ReportContent } from '../server/types';

export type SignatureKind = 'travel' | 'rtp';
export const APP_URL = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://atualizaprojeto.vercel.app');
export const signLink = (id: string) => `${APP_URL}/assinar/${id}`;
export const verifyLink = (code: string) => `${APP_URL}/verificar/${code}`;
const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

/** Valid Brazilian CPF (11 digits with both check digits), returned as digits only. */
export function normalizeCpf(value: string) {
  const d = String(value ?? '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  const check = (len: number) => { let sum = 0; for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i); const r = (sum * 10) % 11; return r === 10 ? 0 : r; };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]) ? d : null;
}
/** JSON with sorted keys, so the same content always yields the same hash. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** Client IP as seen by the Vercel edge (first hop of x-forwarded-for). */
export const clientIp = (request: Request) => (request.headers.get('x-forwarded-for')?.split(',')[0] || request.headers.get('x-real-ip') || '').trim().slice(0, 64);

/** What is signed: the document's content at this moment, with a label and the member it belongs to. */
export async function documentSource(projectId: string, kind: SignatureKind, sourceId: string) {
  if (kind === 'travel') {
    const report = await travelReportById(projectId, sourceId);
    const beneficiary = await beneficiaryOf(projectId, report.scholarId);
    const fill = travelFill(report);
    const content = { beneficiary, fill, photos: report.photos.map((p) => ({ key: p.key, caption: p.caption })) };
    return { kind, sourceId, projectId, scholarId: report.scholarId, version: null as number | null, label: `Formulário 26 — Relatório de Viagem${report.destination ? ` a ${report.destination}` : ''} — ${beneficiary.name}`, content, hash: sha256(stableJson({ kind, sourceId, content })), travel: { report, beneficiary } };
  }
  const [row] = await sql`SELECT r.id,r.scholar_id,r.number,r.current_version,rv.content,s.full_name FROM reports r
    JOIN report_versions rv ON rv.report_id=r.id AND rv.version=r.current_version JOIN scholars s ON s.id=r.scholar_id
    WHERE r.id=${sourceId}::uuid AND r.project_id=${projectId}::uuid AND r.deleted_at IS NULL`;
  if (!row) throw fail('Relatório não encontrado neste projeto.', 404);
  const content = row.content as ReportContent, version = Number(row.current_version);
  return { kind, sourceId, projectId, scholarId: String(row.scholar_id), version, label: `RTP ${row.number} — ${row.full_name}`, content, hash: sha256(stableJson({ kind, sourceId, version, content })), rtp: { number: String(row.number), content } };
}

export type SignerRow = { id: string; step: number; auth_user_id: string; name: string; role_label: string; status: string; cpf: string | null; signed_at: Date | string | null; ip: string | null; user_agent: string | null; document_hash: string | null; signature_hash: string | null; reject_reason: string | null };
export async function loadRequest(id: string) {
  const [request] = await sql`SELECT * FROM signature_requests WHERE id=${id}::uuid`;
  if (!request) throw fail('Solicitação de assinatura não encontrada.', 404);
  const signers = await sql`SELECT * FROM signature_signers WHERE request_id=${id}::uuid ORDER BY step` as SignerRow[];
  return { request, signers };
}
/** Admins of the system and coordinators of the project. */
export async function managesProject(userId: string, projectId: string) {
  return (await sql`SELECT 1 FROM user_project_access WHERE auth_user_id=${userId} AND (role='admin' OR (role='coordinator' AND project_id=${projectId}::uuid)) LIMIT 1`).length > 0;
}
/** Session allowed on a request: one of its signers or a manager of the project. */
export async function requestAccess(id: string) {
  const { user, mustChangePassword } = await requireUser();
  if (mustChangePassword) throw fail('Troque a senha temporária antes de continuar.', 428);
  const loaded = await loadRequest(id);
  const me = loaded.signers.find((s) => s.auth_user_id === user.id) ?? null;
  const manager = await managesProject(user.id, String(loaded.request.project_id));
  if (!me && !manager) throw fail('Este link de assinatura pertence a outra pessoa.', 403);
  const current = loaded.signers.find((s) => s.status === 'pending') ?? null;
  const anySigned = loaded.signers.some((s) => s.status === 'signed');
  // Content may change only before the first signature: afterwards every signer signs the same hash.
  const canEdit = loaded.request.status === 'pending' && !anySigned && (manager || (!!me && current?.id === me.id));
  return { user, ...loaded, me, manager, current, anySigned, canEdit };
}

/** Editing is blocked while a document carries signatures (pending with signatures, or completed). */
export async function assertUnsigned(kind: SignatureKind, sourceId: string) {
  const [locked] = await sql`SELECT r.status FROM signature_requests r WHERE r.source_kind=${kind} AND r.source_id=${sourceId}::uuid
    AND (r.status='completed' OR (r.status='pending' AND EXISTS(SELECT 1 FROM signature_signers s WHERE s.request_id=r.id AND s.status='signed'))) LIMIT 1`;
  if (locked) throw fail(locked.status === 'completed' ? 'Documento assinado eletronicamente: para alterar, cancele as assinaturas em "Assinaturas".' : 'Documento com assinaturas em andamento: cancele a solicitação para alterá-lo.', 409);
}

const iso = (d: unknown) => d instanceof Date ? d.toISOString() : String(d);
/** Signatures to stamp on exports: the completed request, or the open one with at least one signature. */
export async function signatureManifest(kind: SignatureKind, sourceId: string): Promise<SignatureManifest | null> {
  const [request] = await sql`SELECT * FROM signature_requests WHERE source_kind=${kind} AND source_id=${sourceId}::uuid AND status IN ('completed','pending') ORDER BY (status='completed') DESC, created_at DESC LIMIT 1`;
  if (!request) return null;
  const signed = await sql`SELECT * FROM signature_signers WHERE request_id=${request.id}::uuid AND status='signed' ORDER BY step` as SignerRow[];
  if (!signed.length) return null;
  return {
    label: String(request.label), status: request.status === 'completed' ? 'completed' : 'pending',
    documentHash: String(request.document_hash ?? signed[0].document_hash), verificationCode: request.verification_code ? String(request.verification_code) : null,
    verifyUrl: request.verification_code ? verifyLink(String(request.verification_code)) : null,
    signers: signed.map((s) => ({ step: s.step, name: s.name, roleLabel: s.role_label, cpf: String(s.cpf), signedAt: iso(s.signed_at), ip: String(s.ip ?? ''), signatureHash: String(s.signature_hash) }))
  };
}

/** Photo bytes for the export (JPEG, as converted in the browser at upload). */
export async function photoFiles(photos: TravelPhoto[]) {
  const out: NonNullable<TravelFill['photos']> = [];
  for (const p of photos) { try { out.push({ data: await readPrivateObject(p.key, 15 * 1024 * 1024), width: p.width, height: p.height, caption: p.caption }); } catch { /* a missing object must not block the report */ } }
  return out;
}
/** Everything Form 26 prints for a filled report: fields, photos and signatures. */
export async function fullTravelFill(report: Awaited<ReturnType<typeof travelReportById>>): Promise<TravelFill> {
  return { ...travelFill(report), photos: await photoFiles(report.photos), signatures: await signatureManifest('travel', report.id) };
}

const ROLE_LABEL: Record<string, string> = { admin: 'Administração do sistema', coordinator: 'Coordenação do projeto', scholar: 'Bolsista', signer: 'Membro da equipe' };
/** Accounts that can sign documents of a project, with the name and function printed on the signature. */
export async function signerCandidates(projectId: string) {
  const rows = await sql`SELECT DISTINCT ON (a.auth_user_id) a.auth_user_id,a.role,u.email,coalesce(s.full_name,m.name,u.name,u.email) AS name,s.id AS scholar_id,s.role_area,s.phone,
      m.must_change_password,(m.revoked_at IS NOT NULL) AS revoked
    FROM user_project_access a JOIN neon_auth."user" u ON u.id::text=a.auth_user_id
    LEFT JOIN managed_users m ON m.auth_user_id=a.auth_user_id
    LEFT JOIN LATERAL (SELECT id,full_name,role_area,phone FROM scholars WHERE project_id=${projectId}::uuid AND deleted_at IS NULL
      AND (id=a.scholar_id OR auth_user_id=a.auth_user_id OR lower(email)=lower(u.email)) ORDER BY (id=a.scholar_id) DESC NULLS LAST LIMIT 1) s ON true
    WHERE (a.project_id=${projectId}::uuid OR a.role='admin')
    ORDER BY a.auth_user_id,CASE a.role WHEN 'admin' THEN 0 WHEN 'coordinator' THEN 1 WHEN 'scholar' THEN 2 ELSE 3 END`;
  return rows.filter((r) => !r.revoked).map((r) => ({
    authUserId: String(r.auth_user_id), role: String(r.role), email: String(r.email), name: String(r.name),
    scholarId: r.scholar_id ? String(r.scholar_id) : null, roleLabel: String(r.role_area ?? '').trim() || ROLE_LABEL[String(r.role)] || '',
    phone: r.phone ? String(r.phone) : '', pendingFirstAccess: Boolean(r.must_change_password)
  }));
}
