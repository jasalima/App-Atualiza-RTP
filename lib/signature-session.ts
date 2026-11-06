import { auth } from './auth';
import { sha256 } from './hash';

// The session that signs: a signature needs a recent login of the account owner, never an
// administrator acting as someone else. Only a digest of the session id goes to the evidence.
export const MAX_SIGNING_SESSION_HOURS = 12;
const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

export type SessionFacts = { id: string | null; createdAt: string | null; impersonatedBy: string | null };
export function signingSessionCheck(s: SessionFacts, now = Date.now()) {
  if (s.impersonatedBy) throw fail('Assinatura bloqueada: a sessão está sendo usada por outra pessoa (personificação). Somente o titular, com o próprio login, pode assinar.', 403);
  const started = s.createdAt ? new Date(s.createdAt).getTime() : NaN;
  const ageMinutes = Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 60000)) : null;
  if (ageMinutes !== null && ageMinutes > MAX_SIGNING_SESSION_HOURS * 60)
    throw fail(`Por segurança, a assinatura exige um login feito há menos de ${MAX_SIGNING_SESSION_HOURS} horas. Saia do sistema, entre novamente e assine.`, 401);
  return { sessionRef: s.id ? sha256(`rtp-session|${s.id}`).slice(0, 32) : null, sessionStartedAt: Number.isFinite(started) ? new Date(started).toISOString() : null, sessionAgeMinutes: ageMinutes };
}
export async function signingSession() {
  const { data } = await auth.getSession();
  const s = (data as { session?: { id?: string; createdAt?: string | Date; impersonatedBy?: string | null } } | null)?.session;
  return signingSessionCheck({ id: s?.id ?? null, createdAt: s?.createdAt ? new Date(s.createdAt).toISOString() : null, impersonatedBy: s?.impersonatedBy ?? null });
}
