import { createHash } from 'node:crypto';

// Content hashing shared by the signatures and the meeting minutes.
/** JSON with sorted keys, so the same content always yields the same hash. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
/** Public address of the application (production domain on Vercel). */
export const APP_URL = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://atualizaprojeto.vercel.app');
/** The signature hash rule: binds content, request, signer, CPF, time and IP. */
export const signatureHashOf = (p: { documentHash: string; requestId: string; step: number; userId: string; cpf: string; signedAt: string; ip: string }) =>
  sha256([p.documentHash, p.requestId, p.step, p.userId, p.cpf, p.signedAt, p.ip].join('|'));
