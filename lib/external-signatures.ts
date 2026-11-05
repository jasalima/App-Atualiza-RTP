import { randomBytes, randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from './db';
import { APP_URL, sha256, signatureHashOf } from './hash';
import { documentSource, clientIp } from './signatures';
import { normalizeCpf } from './cpf';
import { sealCredential, openCredential } from '../server/services/travel-credentials';
import { moduleSender } from './whatsapp-connections';
import { recordParallelSignature } from './parallel-sign';

const fail = (message: string, status = 403) => Object.assign(new Error(message), { status });
export const guestPhone = (value: string) => value.replace(/\D/g, '');
export const externalLink = (token: string) => `${APP_URL}/assinar-externo/${token}`;
export function secureEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function externalCapability() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}
export function challengeDigest(token: string, code: string) {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!secret) throw fail('Serviço de confirmação indisponível.', 503);
  return createHmac('sha256', secret).update(`external-signature|${token}|${code}`).digest('hex');
}
export function guestSlot(signerId: string, cpf: string, phone: string) {
  const capability = externalCapability();
  return sql`INSERT INTO external_signature_access(signer_id,cpf,phone,token_hash,encrypted_token)
    VALUES(${signerId}::uuid,${cpf},${guestPhone(phone)},${capability.hash},${sealCredential(capability.token, `external:${signerId}`)})`;
}
export async function externalRecipient(signerId: string, completed = false) {
  const [row] = await sql`SELECT phone,encrypted_token,expires_at FROM external_signature_access WHERE signer_id=${signerId}::uuid`;
  if (!row || (!completed && new Date(String(row.expires_at)).getTime() <= Date.now())) return null;
  return { phone: String(row.phone), link: completed ? '' : externalLink(openCredential(String(row.encrypted_token), `external:${signerId}`)) };
}
export async function renewExpiredGuestInvitations(requestId: string) {
  const expired = await sql`SELECT e.signer_id FROM external_signature_access e JOIN signature_signers s ON s.id=e.signer_id JOIN signature_requests r ON r.id=s.request_id
    WHERE r.id=${requestId}::uuid AND r.status='pending' AND s.status='pending' AND (e.expires_at<=now() OR e.sends>=10)`;
  for (const row of expired) {
    const id = String(row.signer_id), capability = externalCapability();
    await sql`UPDATE external_signature_access SET token_hash=${capability.hash},encrypted_token=${sealCredential(capability.token, `external:${id}`)},expires_at=now()+interval '7 days',
      challenge_hash=NULL,challenge_expires_at=NULL,proof_hash=NULL,proof_expires_at=NULL,verified_at=NULL,attempts=0,sends=0,sent_at=NULL
      WHERE signer_id=${id}::uuid AND (expires_at<=now() OR sends>=10) AND EXISTS(SELECT 1 FROM signature_signers s JOIN signature_requests r ON r.id=s.request_id WHERE s.id=${id}::uuid AND s.status='pending' AND r.status='pending')`;
  }
  return expired.length;
}
export async function externalAccess(token: string) {
  if (!/^[\w-]{43}$/.test(token)) throw fail('Link inválido ou expirado.', 404);
  const [row] = await sql`SELECT e.*,s.request_id,s.auth_user_id,s.name,s.step,s.status AS signer_status,r.project_id,r.source_id,r.label,r.status AS request_status,r.created_by
    FROM external_signature_access e JOIN signature_signers s ON s.id=e.signer_id JOIN signature_requests r ON r.id=s.request_id
    JOIN meeting_minute_versions v ON v.id=r.source_id JOIN meeting_minutes m ON m.id=v.minute_id
    WHERE e.token_hash=${sha256(token)} AND r.source_kind='minutes' AND r.mode='parallel' AND v.status='active' AND m.deleted_at IS NULL AND m.status<>'cancelled'`;
  if (!row || new Date(String(row.expires_at)).getTime() <= Date.now() || !['pending', 'completed'].includes(String(row.request_status))) throw fail('Link inválido, expirado ou solicitação cancelada. Solicite um novo encaminhamento à coordenação.', 410);
  return row;
}
type GuestAccess = Awaited<ReturnType<typeof externalAccess>>;
export const proofCookieName = (a: GuestAccess) => `rtp_external_${String(a.signer_id).replace(/-/g, '')}`;
export function hasExternalProof(request: Request, a: GuestAccess) {
  const cookie = (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(`${proofCookieName(a)}=`))?.split('=')[1] ?? '';
  return !!a.proof_hash && new Date(String(a.proof_expires_at)).getTime() > Date.now() && secureEqual(sha256(cookie), String(a.proof_hash));
}
async function guestIdentity(a: GuestAccess, input: string) {
  const cpf = normalizeCpf(input);
  if (!cpf || !secureEqual(cpf, String(a.cpf))) throw fail('O CPF não corresponde ao convidado deste link. Confira os dados com a coordenação.');
  const [member] = await sql`SELECT 1 FROM signer_identities WHERE cpf=${cpf}`;
  if (member) throw fail('Este CPF pertence a uma conta do sistema. Solicite o vínculo correto à coordenação e assine pelo seu próprio login.');
  if (a.request_status !== 'pending' || a.signer_status !== 'pending') throw fail('Esta assinatura já foi registrada ou encerrada.', 409);
  return cpf;
}
export async function sendExternalChallenge(token: string, a: GuestAccess, cpf: string) {
  await guestIdentity(a, cpf);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const digest = challengeDigest(token, code);
  // Persist the throttle before sending, including uncertain provider responses.
  const [reserved] = await sql`UPDATE external_signature_access SET challenge_hash=${digest},challenge_expires_at=now()+interval '5 minutes',attempts=0,sends=sends+1,sent_at=now(),proof_hash=NULL,proof_expires_at=NULL
    WHERE signer_id=${a.signer_id}::uuid AND sends<10 AND (sent_at IS NULL OR sent_at<now()-interval '60 seconds') RETURNING signer_id`;
  if (!reserved) throw fail('Aguarde um minuto antes de pedir outro código. O link permite até dez envios; depois, procure a coordenação.', 429);
  const sender = await moduleSender(String(a.project_id), 'minutes_sender', String(a.created_by));
  if (!sender.connection) throw fail('O WhatsApp responsável pela ata está desconectado. Avise a coordenação.', 503);
  await sender.provider.sendText(sender.connection.instance, sender.connection.token, String(a.phone), `RTP Inteligente\nSeu código de confirmação é ${code}.\nValidade: 5 minutos.\nDocumento: ${a.label}\nNão compartilhe este código. Se não solicitou a assinatura, avise a coordenação.`);
  return { sent: true, phone: `•••• ${String(a.phone).slice(-4)}`, retryAfter: 60 };
}
export async function verifyExternalChallenge(token: string, a: GuestAccess, cpf: string, code: string) {
  await guestIdentity(a, cpf);
  const [attempt] = await sql`UPDATE external_signature_access SET attempts=attempts+1 WHERE signer_id=${a.signer_id}::uuid AND attempts<5 AND challenge_hash IS NOT NULL AND challenge_expires_at>now() RETURNING challenge_hash`;
  if (!attempt || !secureEqual(challengeDigest(token, code), String(attempt.challenge_hash))) throw fail('Código inválido ou expirado. Confira o WhatsApp; após cinco tentativas, solicite outro código.');
  const proof = randomBytes(32).toString('base64url');
  const [verified] = await sql`UPDATE external_signature_access SET verified_at=now(),proof_hash=${sha256(proof)},proof_expires_at=now()+interval '10 minutes',challenge_hash=NULL
    WHERE signer_id=${a.signer_id}::uuid AND challenge_hash=${String(attempt.challenge_hash)} AND challenge_expires_at>now() RETURNING signer_id`;
  if (!verified) throw fail('Código já utilizado. Solicite outro código.');
  return proof;
}
export async function signExternal(request: Request, a: GuestAccess, input: string) {
  const cpf = await guestIdentity(a, input);
  if (!hasExternalProof(request, a)) throw fail('Confirme o código recebido no WhatsApp antes de assinar.');
  const source = await documentSource(String(a.project_id), 'minutes', String(a.source_id));
  const signedAt = new Date().toISOString(), ip = clientIp(request), requestId = String(a.request_id), userId = String(a.auth_user_id), step = Number(a.step);
  const signatureHash = signatureHashOf({ documentHash: source.hash, requestId, userId, step, cpf, signedAt, ip });
  const result = await recordParallelSignature({ requestId, signerId: String(a.signer_id), userId, projectId: String(a.project_id), step, cpf, signedAt, ip,
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 300), documentHash: source.hash, signatureHash, external: true });
  if (!result.recorded) throw fail('A assinatura já foi registrada ou a solicitação mudou. Atualize a página.', 409);
  return { signed: true, completed: result.completed, signedAt };
}
